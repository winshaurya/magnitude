import { Context, Effect, Layer, Stream, Duration } from 'effect'
import { Worker } from '@magnitudedev/event-core'
import type { AppEvent, MessageDestination, TurnOutcome } from '../events'
import { MockTurnScriptTag, type MockTurnResponse } from './turn-script'
import { createHarness } from '@magnitudedev/harness'
import { createStreamingFieldParser, type ResponseStreamEvent, type ModelStreamResult, type ProviderToolCallId, type ToolCallId, type Prompt, type StreamingFieldParser } from '@magnitudedev/ai'
import type { MagnitudeStreamError } from '@magnitudedev/magnitude-client'
import { createHarnessAdapter, type IdenticalResponseTracker } from '../execution/harness-adapter'
import { ExecutionManager } from '../execution/types'
import { getAgentDefinition } from '../agents/registry'
import { getToolkitForRole, isToolKey, type ToolKey } from '../tools/toolkits'
import { buildStandardHooks } from '../execution/harness-hooks'
import { SessionContextProjection } from '../projections/session-context'
import { mapStreamErrorToOutcome } from '../errors'
import type { RoleId } from '../agents/role-validation'

// ── XML → ResponseStreamEvent conversion ─────────────────────────────

interface ParsedXmlResult {
  readonly events: ResponseStreamEvent<MagnitudeStreamError>[]
  readonly parsers: ReadonlyMap<ToolCallId, StreamingFieldParser>
}

/**
 * Convert XML script frame into ResponseStreamEvent sequences and parsers.
 * Handles the limited set of XML constructs used in tests:
 * - <magnitude:message to="...">text</magnitude:message>
 * - <magnitude:invoke tool="..."><magnitude:parameter name="...">value</magnitude:parameter></magnitude:invoke>
 * - <magnitude:yield_user/>
 * - <lens name="...">text</lens>
 */
function parseXmlScript(xml: string, toolkit: import('@magnitudedev/harness').Toolkit): ParsedXmlResult {
  const events: ResponseStreamEvent<MagnitudeStreamError>[] = []
  const parsers = new Map<ToolCallId, StreamingFieldParser>()
  let toolCallCounter = 0
  let remaining = xml

  while (remaining.length > 0) {
    // Skip whitespace
    const wsMatch = remaining.match(/^\s+/)
    if (wsMatch) {
      remaining = remaining.slice(wsMatch[0].length)
      continue
    }

    // <magnitude:yield_user/>
    const yieldMatch = remaining.match(/^<magnitude:yield_user\s*\/>/)
    if (yieldMatch) {
      remaining = remaining.slice(yieldMatch[0].length)
      continue
    }

    // <lens name="...">text</lens>
    const lensMatch = remaining.match(/^<lens\s+name="([^"]*)">([\s\S]*?)<\/lens>/)
    if (lensMatch) {
      events.push({ _tag: 'thought_start', level: 'medium' })
      events.push({ _tag: 'thought_delta', text: lensMatch[2] })
      events.push({ _tag: 'thought_end' })
      remaining = remaining.slice(lensMatch[0].length)
      continue
    }

    // <magnitude:message to="...">text</magnitude:message>
    const msgMatch = remaining.match(/^<magnitude:message\s+to="([^"]*)">([\s\S]*?)<\/magnitude:message>/)
    if (msgMatch) {
      events.push({ _tag: 'message_start' })
      events.push({ _tag: 'message_delta', text: msgMatch[2] })
      events.push({ _tag: 'message_end' })
      remaining = remaining.slice(msgMatch[0].length)
      continue
    }

    // <magnitude:invoke tool="...">...parameters...</magnitude:invoke>
    const invokeMatch = remaining.match(/^<magnitude:invoke\s+tool="([^"]*)">([\s\S]*?)<\/magnitude:invoke>/)
    if (invokeMatch) {
      const toolName = invokeMatch[1]
      const paramsXml = invokeMatch[2]
      const toolCallId = `mock-tc-${++toolCallCounter}` as ToolCallId
      const providerToolCallId = `mock-tc-${toolCallCounter}` as ProviderToolCallId

      // Collect parameters
      const params: Record<string, string> = {}
      const paramRegex = /<magnitude:parameter\s+name="([^"]*)">([\s\S]*?)<\/magnitude:parameter>/g
      let paramMatch
      while ((paramMatch = paramRegex.exec(paramsXml)) !== null) {
        params[paramMatch[1]] = paramMatch[2]
      }

      // Create parser with tool's input schema so decoded works correctly
      const toolKey = (() => {
        for (const key of toolkit.keys) {
          const entry = toolkit.entries[key]
          if ((entry.tool as { readonly definition: { readonly name: string } }).definition.name === toolName) return key
        }
        return undefined
      })()
      const toolEntry = toolKey ? toolkit.entries[toolKey] : undefined
      const inputSchema = toolEntry
        ? (toolEntry.tool as { readonly definition: { readonly inputSchema: import('effect').Schema.Schema.AnyNoContext } }).definition.inputSchema
        : undefined
      const parser = inputSchema ? createStreamingFieldParser(inputSchema) : createStreamingFieldParser()
      parser.push(JSON.stringify(params))
      parser.end()
      parsers.set(toolCallId, parser)

      events.push({ _tag: 'tool_call_start', toolCallId, providerToolCallId, toolName })

      for (const [field, value] of Object.entries(params)) {
        events.push({ _tag: 'tool_call_field_delta', toolCallId, providerToolCallId, path: [field], delta: value })
        events.push({ _tag: 'tool_call_field_end', toolCallId, providerToolCallId, path: [field], value })
      }

      // If parser decoded successfully, emit tool_call_ready; otherwise emit validation_failure
      if (parser.decoded !== null) {
        events.push({ _tag: 'tool_call_ready', toolCallId, providerToolCallId })
      } else {
        // Push stream_end with validation_failure — skip to end of XML
        events.push({
          _tag: 'stream_end',
          reason: { _tag: 'validation_failure', toolCallId, providerToolCallId, toolName, issue: { path: [], message: 'Schema validation failed for tool input' } },
          usage: null,
        })
        remaining = remaining.slice(invokeMatch[0].length)
        return { events, parsers }
      }
      remaining = remaining.slice(invokeMatch[0].length)
      continue
    }

    // Unrecognized text — treat as message content
    const textMatch = remaining.match(/^[^<]+/)
    if (textMatch) {
      events.push({ _tag: 'message_start' })
      events.push({ _tag: 'message_delta', text: textMatch[0] })
      events.push({ _tag: 'message_end' })
      remaining = remaining.slice(textMatch[0].length)
      continue
    }

    // Skip unrecognized tags
    const tagMatch = remaining.match(/^<[^>]*>/)
    if (tagMatch) {
      remaining = remaining.slice(tagMatch[0].length)
      continue
    }

    break
  }

  const hasToolCalls = events.some(e => e._tag === 'tool_call_start')
  events.push({
    _tag: 'stream_end',
    reason: { _tag: 'completed', finishReason: hasToolCalls ? 'tool_calls' : 'stop' },
    usage: null,
  })

  return { events, parsers }
}

// ── Mock model ───────────────────────────────────────────────────────

function createMockModel(frame: MockTurnResponse, toolkit: import('@magnitudedev/harness').Toolkit) {
  const xml = frame.xml ?? '<magnitude:message to="user">ok</magnitude:message>'
  const parsed = parseXmlScript(xml, toolkit)

  let eventStream: Stream.Stream<ResponseStreamEvent<MagnitudeStreamError>, never>
  if (frame.delayMsBetweenChunks) {
    eventStream = Stream.fromIterable(parsed.events).pipe(
      Stream.tap(() => Effect.sleep(Duration.millis(frame.delayMsBetweenChunks!)))
    )
  } else {
    eventStream = Stream.fromIterable(parsed.events)
  }

  const model = {
    spec: { modelId: 'mock-model', endpoint: 'mock', bind: () => { throw new Error('unused') }, _execute: () => { throw new Error('unused') } },
    stream: (_prompt: Prompt, _toolDefs: readonly unknown[]) =>
      Effect.succeed({
        events: eventStream,
        parsers: parsed.parsers,
        logprobs: [],
      } satisfies ModelStreamResult<MagnitudeStreamError>),
  }

  return model
}

// ── Destination resolution ───────────────────────────────────────────

function resolveDefaultDest(forkId: string | null): MessageDestination {
  return forkId === null ? { kind: 'user' } : { kind: 'parent' }
}

// ── Tracker state persisted across turns per fork ─────────────────────
export class ForkTrackersTag extends Context.Tag('ForkTrackers')<ForkTrackersTag, Map<string | null, IdenticalResponseTracker>>() {}

export const ForkTrackersLive = Layer.sync(ForkTrackersTag, () => new Map<string | null, IdenticalResponseTracker>())

// ── MockCortex ───────────────────────────────────────────────────────

export const MockCortex = Worker.defineForked<AppEvent>()({
  name: 'MockCortex',

  forkLifecycle: {
    activateOn: 'agent_created',
  },

  eventHandlers: {
    turn_started: (event, publish) => {
      const { forkId, turnId, chainId } = event

      return Effect.gen(function* () {
        const script = yield* MockTurnScriptTag
        const frame = yield* script.dequeue({ forkId, turnId })
        const execManager = yield* ExecutionManager

        const roleId: RoleId = forkId === null ? 'leader' : 'engineer'
        const toolkit = getToolkitForRole(roleId)
        const agentDef = getAgentDefinition(roleId)
        const sessionCtx = yield* (yield* SessionContextProjection.Tag).get
        const scratchpadPath = sessionCtx.context?.scratchpadPath ?? '/tmp/test'
        const forkLayer = execManager.getForkLayer(forkId)

        const model = createMockModel(frame, toolkit)

        const harness = createHarness({
          model,
          toolkit,
          mapStreamError: mapStreamErrorToOutcome,
          layer: forkLayer,
          hooks: buildStandardHooks({ forkId, turnId, agentDef, scratchpadPath }),
        })

        const adapter = createHarnessAdapter({
          forkId,
          turnId,
          chainId,
          roleId,
          defaultProseDest: resolveDefaultDest(forkId),
          publish,
          identicalResponseTracker: (yield* ForkTrackersTag).get(forkId) ?? null,
          resolveToolKey: (toolName: string) => {
            for (const key of toolkit.keys) {
              const entry = toolkit.entries[key]
              if ((entry.tool as { readonly definition: { readonly name: string } }).definition.name === toolName) {
                return key as ToolKey
              }
            }
            return undefined
          },
        })

        // Build a minimal prompt — tests don't care about prompt content
        const { Prompt: PromptClass } = yield* Effect.promise(() => import('@magnitudedev/ai'))
        const prompt = PromptClass.from({
          system: '',
          messages: [{ _tag: 'UserMessage', parts: [{ _tag: 'TextPart', text: 'test' }] }],
        })

        const liveTurn = yield* harness.runTurn(prompt)

        yield* Stream.runForEach(liveTurn.events, (harnessEvent) =>
          adapter.processEvent(harnessEvent)
        )

        const executeResult = adapter.getResult()
        const updatedTracker = adapter.getIdenticalResponseTracker()
        if (updatedTracker) {
          ;(yield* ForkTrackersTag).set(forkId, updatedTracker)
        }
        yield* publish({
          type: 'turn_outcome',
          forkId,
          turnId,
          chainId,
          strategyId: 'native',
          outcome: executeResult.result,
          inputTokens: frame.usage?.inputTokens ?? null,
          outputTokens: frame.usage?.outputTokens ?? null,
          cacheReadTokens: frame.usage?.cacheReadTokens ?? null,
          cacheWriteTokens: frame.usage?.cacheWriteTokens ?? null,
          providerId: null,
          modelId: 'mock-model',
        })
      }).pipe(
        Effect.catchAllCause((cause) =>
          publish({
            type: 'turn_outcome',
            forkId,
            turnId,
            chainId,
            strategyId: 'native',
            outcome: { _tag: 'UnexpectedError', message: `MockCortex error: ${cause}` },
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            providerId: null,
            modelId: null,
          })
        ),
        Effect.onInterrupt(() =>
          publish({
            type: 'turn_outcome',
            forkId,
            turnId,
            chainId,
            strategyId: 'native',
            outcome: { _tag: 'Cancelled', reason: { _tag: 'UserInterrupt' } },
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            providerId: null,
            modelId: null,
          })
        ),
      )
    },
  },
})
