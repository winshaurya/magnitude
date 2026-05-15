import { describe, it } from '@effect/vitest'
import { Effect, Stream, Schema } from 'effect'
import { FetchHttpClient } from '@effect/platform'
import { expect } from 'vitest'
import { createHarness } from '../harness'
import { defineHarnessTool } from '../../tool/tool'
import { defineToolkit } from '../../tool/toolkit'
import type { BoundModel, ProviderToolCallId, ToolCallId, ResponseStreamEvent, StreamingFieldParser } from '@magnitudedev/ai'
import { createStreamingFieldParser } from '@magnitudedev/ai'

// ── Test tool that always errors ─────────────────────────────────────

const inputSchema = Schema.Struct({ value: Schema.String })

const failTool = defineHarnessTool({
  definition: { name: 'fail', description: 'Always fails', inputSchema },
  execute: () => Effect.fail(new Error('tool failed')),
})

const toolkit = defineToolkit({ fail: { tool: failTool } })

// ── Mock model ───────────────────────────────────────────────────────

type StreamEvent = ResponseStreamEvent<never>

function createMockModel(events: StreamEvent[], parsers: Map<ToolCallId, StreamingFieldParser>): BoundModel<any, never, never> {
  return {
    spec: {
      modelId: 'test',
      endpoint: 'test',
    } as any,
    stream: () =>
      Effect.succeed({
        events: Stream.fromIterable(events),
        parsers,
        logprobs: [],
      }),
  }
}

// ── Test ──────────────────────────────────────────────────────────────

describe('harness queue race (runTurn consumer)', () => {
  it('delivers TurnEnd with ToolExecutionError to the event stream consumer', () =>
    Effect.gen(function* () {
      const callId = 'call-1' as ToolCallId
      const providerToolCallId = 'call-1' as ProviderToolCallId

      // Build parser for the tool call
      const parser = createStreamingFieldParser(inputSchema)
      parser.push('{"value":"x"}')
      parser.end()
      const parsers = new Map<ToolCallId, StreamingFieldParser>([[callId, parser]])

      const streamEvents: StreamEvent[] = [
        { _tag: 'tool_call_start', toolCallId: callId, providerToolCallId, toolName: 'fail' },
        { _tag: 'tool_call_field_start', toolCallId: callId, providerToolCallId, path: ['value'] },
        { _tag: 'tool_call_field_delta', toolCallId: callId, providerToolCallId, path: ['value'], delta: '"x"' },
        { _tag: 'tool_call_field_end', toolCallId: callId, providerToolCallId, path: ['value'], value: 'x' },
        { _tag: 'tool_call_ready', toolCallId: callId, providerToolCallId },
        { _tag: 'stream_end', reason: { _tag: 'completed', finishReason: 'tool_calls' }, usage: null },
      ]

      const model = createMockModel(streamEvents, parsers)

      const harness = createHarness({
        model,
        toolkit,
        mapStreamError: () => ({ _tag: 'EngineDefect' as const, message: 'stream error' }),
      })

      // Run a turn and consume events — exactly as cortex does
      const turn = yield* harness.runTurn({ messages: [], tools: [] })

      // Allow the forked dispatch fiber to complete and shut down the
      // queue before we start consuming. This reliably reproduces the
      // race that occurs in production when the cortex does async work
      // between obtaining the LiveTurn and draining its event stream.
      yield* Effect.sleep("50 millis")

      const events: Array<{ _tag: string }> = []
      yield* Stream.runForEach(turn.events, (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
      )

      // The consumer must see a TurnEnd event
      const turnEnd = events.find((e) => e._tag === 'TurnEnd') as any
      expect(turnEnd, 'TurnEnd event must be delivered to the consumer').toBeDefined()

      // The outcome must be ToolExecutionError, not Completed
      expect(turnEnd.outcome._tag).toBe('ToolExecutionError')
    }).pipe(Effect.provide(FetchHttpClient.layer), Effect.runPromise),
  )
})
