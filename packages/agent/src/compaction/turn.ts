/**
 * Agentic compaction turn — runs a normal agent turn for reflection/summarization.
 */

import { Effect, Layer, Stream, Ref } from 'effect'

import { AmbientServiceTag } from '@magnitudedev/event-core'
import { logger } from '@magnitudedev/logger'
import { createHarness } from '@magnitudedev/harness'

import { renderToolDocs } from '../prompts/render-tool-docs'

import type { AppEvent } from '../events'
import { mapStreamErrorToOutcome } from '../errors/classify'

import type { ForkWindowState } from '../window'
import type { CompletedTurn } from '../window/types'
import { SessionContextProjection } from '../projections/session-context'
import { AgentModelResolver } from '../model/model-resolver'
import { getAgentDefinition } from '../agents/registry'
import { getToolkitForRole } from '../tools/toolkits'
import { buildSystemPrompt } from '../prompts/system-prompt-builder'
import { buildCompactionPrompt } from './prompt'
import { createToolResultFormatter } from '@magnitudedev/harness'
import { createAgentFormatter } from '../prompts/window-to-prompt'
import { resolveImageDescriptions } from '../util/describe-image'
import { CompactionContextTag, type CompactResult } from './context'
import { computeCompactionSizing } from './estimate'

import { TraceListener, type ModelCallTrace } from '@magnitudedev/ai'
import type { AgentCallTrace } from '@magnitudedev/tracing'
import { writeTrace } from '@magnitudedev/tracing'
import { ChatPersistence } from '../persistence/chat-persistence-service'
import { ExecutionManager } from '../execution/types'
import { SkillsAmbient } from '../ambient/skills-ambient'
import { buildStandardHooks } from '../execution/harness-hooks'
import type { RoleId } from '../agents/role-validation'
import { COMPACTION_MAX_RETRIES } from '../constants'
import type { AgentStatusState } from '../projections/agent-status'

export interface CompactionTurnResult {
  readonly turn: CompletedTurn
  readonly compactionOutcome: { readonly isFallback: false; readonly compactResult: CompactResult } | { readonly isFallback: true }
  readonly inputTokens: number | null
  readonly outputTokens: number | null
}

export function runCompactionTurn(
  forkId: string | null,
  roleId: RoleId,
  windowState: ForkWindowState,
  softCap: number,
  publish: (event: AppEvent) => Effect.Effect<void>,
  read: any,
  agentStatus: AgentStatusState,
): Effect.Effect<CompactionTurnResult, any, any> {
  return Effect.gen(function* () {
    const agentDef = getAgentDefinition(roleId)

    // Resolve model (same as Cortex)
    const modelResolver = yield* AgentModelResolver
    const agentModel = yield* modelResolver.resolve(roleId)

    // Get toolkit and fork layer (same as Cortex)
    const toolkit = getToolkitForRole(roleId)
    const execManager = yield* ExecutionManager
    const forkLayer = execManager.getForkLayer(forkId)
    if (!forkLayer) {
      return yield* Effect.fail(new Error('Fork layer not initialized'))
    }

    // Session context
    const sessionCtx = yield* read(SessionContextProjection)
    const scratchpadPath = sessionCtx.context?.scratchpadPath ?? process.cwd()
    const ambientService = yield* AmbientServiceTag
    const skills = ambientService.getValue(SkillsAmbient)

    // Compute budget for compact() tool
    const { keptTailTokens } = computeCompactionSizing(windowState.messages, softCap)
    const sessionContextTokens = windowState.messages[0]?.estimatedTokens ?? 0
    const margin = 2000
    const maxPayloadTokens = Math.max(
      4000,
      softCap - windowState.systemPromptTokens - sessionContextTokens - keptTailTokens - margin,
    )

    // Create CompactionContextTag layer with shared result ref
    const compactResultRef = yield* Ref.make<CompactResult | null>(null)
    const compactionLayer = Layer.succeed(CompactionContextTag, {
      isCompacting: true as const,
      resultRef: compactResultRef,
      maxPayloadTokens,
    })

    // Override TraceListener to tag compaction calls with callType: "compact"
    const persistence = yield* ChatPersistence
    const sessionMetadata = yield* persistence.getSessionMetadata()
    const traceLayer = Layer.succeed(TraceListener, {
      onTrace: (trace: ModelCallTrace) => {
        const agentTrace: AgentCallTrace = {
          ...trace,
          sessionId: sessionMetadata.sessionId,
          agentId: roleId,
          forkId,
          callType: 'compact',
        }
        writeTrace(agentTrace)
      },
    })

    const turnLayer = Layer.merge(forkLayer, compactionLayer)

    // Retry loop: attempt up to COMPACTION_MAX_RETRIES times
    let lastTurn: CompletedTurn | null = null
    let lastInputTokens: number | null = null
    let lastOutputTokens: number | null = null

    for (let attempt = 0; attempt < COMPACTION_MAX_RETRIES; attempt++) {
      // Reset ref for each attempt
      yield* Ref.set(compactResultRef, null)

      const compactionTurnId = `compaction-${Date.now()}-${attempt}`
      const harness = createHarness({
        model: agentModel.model,
        toolkit,
        mapStreamError: mapStreamErrorToOutcome,
        layer: turnLayer,
        hooks: buildStandardHooks({ forkId, turnId: compactionTurnId, agentDef, scratchpadPath }),
      })

      // Build system prompt (identical to normal turns → prefix cache preserved)
      const toolDefs = harness.getToolDefinitions()
      const toolDocs = toolDefs.length > 0 ? renderToolDocs(toolDefs) : ''
      const systemPrompt = buildSystemPrompt({
        roleDef: agentDef,
        skills,
        lenses: [],
        toolDocs,
      })

      // Build compaction prompt: full window + reflection instruction appended
      const timezone = sessionCtx.context?.timezone ?? null
      const formatter = createAgentFormatter(createToolResultFormatter(toolkit))
      const compactionPrompt = buildCompactionPrompt(windowState, systemPrompt, timezone, agentStatus, formatter)

      // Resolve image descriptions for non-vision models (same pattern as Cortex)
      const resolvedPrompt = agentModel.profile.capabilities.vision
        ? compactionPrompt
        : yield* Effect.promise(() => resolveImageDescriptions(compactionPrompt))

      // Run turn (provide traceLayer so model call is tagged as "compact")
      const liveTurn = yield* Effect.provide(harness.runTurn(resolvedPrompt), traceLayer)
      yield* Stream.runForEach(liveTurn.events, () => Effect.void)

      // Build CompletedTurn from canonical turn state
      const state = yield* Ref.get(liveTurn.state)
      const canonical = state.canonical
      const hasContent = (canonical.assistantMessage.text && canonical.assistantMessage.text.trim().length > 0)
        || (canonical.assistantMessage.toolCalls && canonical.assistantMessage.toolCalls.length > 0)

      if (hasContent) {
        lastTurn = {
          turnId: compactionTurnId,
          assistant: canonical.assistantMessage,
          toolResults: [...canonical.toolResults],
          feedback: [],
          clean: true,
        }
      }

      lastInputTokens = canonical.usage?.inputTokens ?? null
      lastOutputTokens = canonical.usage?.outputTokens ?? null

      // Check if compact() was called
      const compactResult = yield* Ref.get(compactResultRef)
      if (compactResult !== null) {
        return {
          turn: lastTurn!,
          compactionOutcome: { isFallback: false, compactResult },
          inputTokens: lastInputTokens,
          outputTokens: lastOutputTokens,
        }
      }

      if (attempt < COMPACTION_MAX_RETRIES - 1) {
        logger.warn({ forkId, attempt: attempt + 1 }, '[CompactionTurn] Agent did not call compact(), retrying')
      }
    }

    // All retries exhausted — fallback
    logger.warn({ forkId }, '[CompactionTurn] All compaction retries exhausted, falling back to tail preservation')

    if (!lastTurn) {
      return yield* Effect.fail(new Error('Empty compaction response after all retries'))
    }

    return {
      turn: lastTurn,
      compactionOutcome: { isFallback: true },
      inputTokens: lastInputTokens,
      outputTokens: lastOutputTokens,
    }
  })
}