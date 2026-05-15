/**
 * Cortex Worker (Forked) — Harness Paradigm
 *
 * Thin orchestrator: resolve model → build harness → run turn → publish events → publish outcome.
 *
 * Uses:
 *  - AgentModelResolver to resolve a model for the role
 *  - createHarness to stream model responses and dispatch tool execution
 *  - createHarnessAdapter to translate HarnessEvent → AppEvent
 */

import { Effect, Layer, Stream } from 'effect'
import { Worker, AmbientServiceTag, Fork } from '@magnitudedev/event-core'
import { logger } from '@magnitudedev/logger'
import { createHarness } from '@magnitudedev/harness'
import type { MagnitudeConnectionError } from '@magnitudedev/magnitude-client'
import { renderToolDocs } from '../prompts/render-tool-docs'

import type { AppEvent } from '../events'
import { mapConnectionErrorToOutcome, mapStreamErrorToOutcome } from '../errors'

import { WindowProjection } from '../window'
import { SessionContextProjection } from '../projections/session-context'
import { AgentStatusProjection } from '../projections/agent-status'
import { HarnessStateProjection } from '../projections/harness-state'
import { TurnProjection } from '../projections/turn'
import { MAX_RETRIES, TERMINAL_RETRY_EXHAUSTED_MESSAGE } from '../util/retry-backoff'

import { AgentModelResolver } from '../model/model-resolver'
import { getAgentDefinition, getForkInfo } from '../agents/registry'
import { getToolkitForRole } from '../tools/toolkits'
import { createHarnessAdapter } from '../execution/harness-adapter'
import { buildSystemPrompt } from '../prompts/system-prompt-builder'
import { windowToPrompt, createAgentFormatter } from '../prompts/window-to-prompt'
import { createToolResultFormatter } from '@magnitudedev/harness'

import { ExecutionManager } from '../execution/types'
import { SkillsAmbient } from '../ambient/skills-ambient'
import { buildInterruptedTurnOutcome } from '../util/interrupt-utils'
import type { ObservationPart } from '../events'
import type { ObservablePart } from '../observables/types'

function toObservationPart(part: ObservablePart): ObservationPart {
  switch (part._tag) {
    case 'TextPart':
      return { type: 'text', text: part.text }
    case 'ImagePart':
      return { type: 'image', base64: part.data, mediaType: part.mediaType, dimensions: part.dimensions }
  }
}
import { isToolKey, type ToolKey } from '../tools/toolkits'
import { resolveImageDescriptions } from '../util/describe-image'

import { buildStandardHooks } from '../execution/harness-hooks'
import { TurnContextTag } from '../engine/turn-context'

const { ForkContext } = Fork

// =============================================================================
// Worker
// =============================================================================

export const Cortex = Worker.defineForked<AppEvent>()({
  name: 'Cortex',

  forkLifecycle: {
    activateOn: 'agent_created',
    completeOn: ['agent_killed', 'subagent_user_killed', 'subagent_idle_closed'],
  },

  eventHandlers: {
    subagent_user_killed: (event) => Effect.gen(function* () {
      if (event.forkId === null) return
      return yield* Effect.interrupt
    }),

    subagent_idle_closed: (event) => Effect.gen(function* () {
      if (event.forkId === null) return
      return yield* Effect.interrupt
    }),

    turn_started: (event, publish, read) => {
      const { forkId, turnId, chainId } = event

      return Effect.gen(function* () {
        // ──────────────────────────────────────────────────────────────────────
        // 1. Read projections
        // ──────────────────────────────────────────────────────────────────────
        const sessionCtx   = yield* read(SessionContextProjection)
        const agentState   = yield* read(AgentStatusProjection)
        const windowState  = yield* read(WindowProjection, forkId)
        const harnessState = yield* read(HarnessStateProjection, forkId)

        const forkInfo = getForkInfo(agentState, forkId)
        if (!forkInfo) return

        const { roleId } = forkInfo
        const agentDef = getAgentDefinition(roleId)

        // ──────────────────────────────────────────────────────────────────────
        // 2. Resolve model
        // ──────────────────────────────────────────────────────────────────────
        const modelResolver = yield* AgentModelResolver
        const agentModel = yield* modelResolver.resolve(roleId)

        // ──────────────────────────────────────────────────────────────────────
        // 3. Observations
        // ──────────────────────────────────────────────────────────────────────
        const execManager = yield* ExecutionManager
        const observations: ObservationPart[] = []
        const boundObs = execManager.getObservables(forkId)
        for (const obs of boundObs) {
          const parts = yield* obs.observe()
          observations.push(...parts.map(toObservationPart))
        }
        if (observations.length > 0) {
          yield* publish({ type: 'observations_captured', forkId, turnId, parts: observations })
        }

        // ──────────────────────────────────────────────────────────────────────
        // 4. Get toolkit and fork layer
        // ──────────────────────────────────────────────────────────────────────
        const toolkit = getToolkitForRole(roleId)
        const forkLayer = execManager.getForkLayer(forkId)
        if (!forkLayer) {
          logger.error({ forkId, turnId }, '[Cortex] Fork layer not initialized — aborting turn')
          yield* publish({
            type: 'turn_outcome', forkId, turnId, chainId,
            strategyId: 'native',
            outcome: { _tag: 'UnexpectedError', message: 'Fork layer not initialized', detail: { _tag: 'CortexDefect' } },
            inputTokens: null, outputTokens: null,
            cacheReadTokens: null, cacheWriteTokens: null,
            providerId: 'magnitude', modelId: agentModel.modelId,
          })
          return
        }

        const turnContextLayer = Layer.succeed(TurnContextTag, { turnId, forkId })
        const turnLayer = Layer.merge(forkLayer, turnContextLayer)

        // ──────────────────────────────────────────────────────────────────────
        // 5. Build system prompt
        // ──────────────────────────────────────────────────────────────────────
        const ambientService = yield* AmbientServiceTag
        const skills = ambientService.getValue(SkillsAmbient)

        const scratchpadPath = sessionCtx.context?.scratchpadPath ?? process.cwd()

        // Pass engine state for crash recovery — allows the harness to skip
        // tools that already executed before the process crashed.
        const engineState = harnessState?.engine
        const hasRecoverableState = engineState && engineState.toolOutcomes.size > 0

        const harness = createHarness({
          model: agentModel.model,
          toolkit,
          mapStreamError: mapStreamErrorToOutcome,
          layer: turnLayer,
          initialState: hasRecoverableState ? engineState : undefined,
          hooks: buildStandardHooks({
            forkId,
            turnId,
            agentDef,
            scratchpadPath,
          }),
        })

        const toolDefs = harness.getToolDefinitions()
        const toolDocs = toolDefs.length > 0
          ? renderToolDocs(toolDefs)
          : ''

        const systemPrompt = buildSystemPrompt({
          roleDef: agentDef,
          skills,
          lenses: [],
          toolDocs,
        })

        // ──────────────────────────────────────────────────────────────────────
        // 6. Build prompt from memory
        // ──────────────────────────────────────────────────────────────────────
        const timezone = sessionCtx.context?.timezone ?? null
        const formatter = createAgentFormatter(createToolResultFormatter(toolkit))
        const rawPrompt = windowToPrompt(windowState, systemPrompt, timezone, agentState, formatter)

        // Resolve image descriptions — replaces ImageParts with text descriptions
        // from the vision preprocessing registry (started on image upload/paste).
        const prompt = agentModel.profile.capabilities.vision
          ? rawPrompt
          : yield* Effect.promise(() => resolveImageDescriptions(rawPrompt))

        // ──────────────────────────────────────────────────────────────────────
        // 7. Build adapter
        // ──────────────────────────────────────────────────────────────────────
        const agentKind = agentDef.agentKind
        const defaultProseDest = agentKind === 'worker'
          ? { kind: 'parent' as const }
          : { kind: 'user' as const }

        // Build toolName → ToolKey map from toolkit
        const toolNameToKey = new Map<string, ToolKey>()
        for (const key of toolkit.keys) {
          if (isToolKey(key)) {
            const entry = toolkit.entries[key]
            const toolName = entry.tool.definition.name
            toolNameToKey.set(toolName, key as ToolKey)
          }
        }

        const adapter = createHarnessAdapter({
          forkId,
          turnId,
          chainId,
          roleId,
          defaultProseDest,
          publish,
          identicalResponseTracker: null,
          resolveToolKey: (toolName: string) => toolNameToKey.get(toolName),
        })

        // ──────────────────────────────────────────────────────────────────────
        // 8. Run turn
        // ──────────────────────────────────────────────────────────────────────
        const liveTurn = yield* harness.runTurn(prompt).pipe(
          Effect.catchAll((err: MagnitudeConnectionError) => Effect.gen(function* () {
            logger.error({ forkId, turnId, err }, '[Cortex] Pre-stream connection error')
            const classified = mapConnectionErrorToOutcome(err)

            // If this is a connection failure and we've already retried MAX times,
            // terminate the chain with a friendly UnexpectedError instead of
            // letting the projection schedule another retry.
            let outcome = classified
            if (classified._tag === 'ConnectionFailure') {
              const turnFork = yield* read(TurnProjection, forkId)
              const retryCount = turnFork?.connectionRetryCount ?? 0
              if (retryCount >= MAX_RETRIES) {
                outcome = {
                  _tag: 'UnexpectedError',
                  message: TERMINAL_RETRY_EXHAUSTED_MESSAGE,
                  detail: { _tag: 'Unknown' },
                }
              }
            }

            yield* publish({
              type: 'turn_outcome', forkId, turnId, chainId,
              strategyId: 'native',
              outcome,
              inputTokens: null, outputTokens: null,
              cacheReadTokens: null, cacheWriteTokens: null,
              providerId: 'magnitude', modelId: agentModel.modelId,
            })
            return null
          })),
        )

        if (liveTurn === null) return

        // ──────────────────────────────────────────────────────────────────────
        // 9. Consume events via adapter
        // ──────────────────────────────────────────────────────────────────────
        yield* Stream.runForEach(liveTurn.events, (event) => adapter.processEvent(event))

        // ──────────────────────────────────────────────────────────────────────
        // 10. Publish turn_outcome
        // ──────────────────────────────────────────────────────────────────────
        const executeResult = adapter.getResult()

        yield* publish({
          type: 'turn_outcome', forkId, turnId, chainId,
          strategyId: 'native',
          outcome: executeResult.result,
          inputTokens:      executeResult.usage?.inputTokens ?? null,
          outputTokens:     executeResult.usage?.outputTokens ?? null,
          cacheReadTokens:  executeResult.usage?.cacheReadTokens ?? null,
          cacheWriteTokens: executeResult.usage?.cacheWriteTokens ?? null,
          providerId: 'magnitude',
          modelId:    agentModel.modelId,
        })
      }).pipe(
        Effect.onInterrupt(() => Effect.gen(function* () {
          const turnOutcome = yield* buildInterruptedTurnOutcome({ forkId, turnId, chainId })
          yield* publish(turnOutcome)
        }).pipe(Effect.orDie)),
        Effect.catchAll((error: unknown) => Effect.gen(function* () {
          const message = error instanceof Error ? error.message : String(error)
          logger.error({ context: 'Cortex', forkId, turnId, error: message }, '[Cortex] Unexpected error in turn_started')
          yield* publish({
            type: 'turn_outcome', forkId, turnId, chainId,
            strategyId: 'native',
            outcome: { _tag: 'UnexpectedError', message, detail: { _tag: 'CortexDefect' } },
            inputTokens: null, outputTokens: null,
            cacheReadTokens: null, cacheWriteTokens: null,
            providerId: null, modelId: null,
          })
        })),
      )
    },
  },
})


