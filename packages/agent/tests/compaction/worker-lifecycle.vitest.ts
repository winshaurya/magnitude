import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { ResponseStreamEvent } from '@magnitudedev/ai'
import type { MagnitudeStreamError } from '@magnitudedev/magnitude-client'
import { TestHarness, TestHarnessLive } from '../../src/test-harness/harness'
import { getCompaction, mkContextLimitHit, mkTurnOutcomeEvent } from './helpers'

/** Stream events that produce a non-empty assistant response */
const successResponse: ResponseStreamEvent<MagnitudeStreamError>[] = [
  { _tag: 'message_start' },
  { _tag: 'message_delta', text: '--- REFLECTION START ---\nWorker summary of prior work.\n--- REFLECTION END ---' },
  { _tag: 'message_end' },
  { _tag: 'stream_end', reason: { _tag: 'completed', finishReason: 'stop' }, usage: null },
]

const workerLayer = TestHarnessLive({ workers: { compaction: true }, model: { responses: [successResponse] } })

const largeUserMessage = {
  type: 'user_message' as const,
  messageId: 'w',
  forkId: null,
  timestamp: Date.now(),
  content: [{ _tag: 'TextPart' as const, text: 'X'.repeat(60_000) }],
  attachments: [],
  mode: 'text' as const,
  synthetic: false,
  taskMode: false,
}

/**
 * Helper: after compaction_prepared, the worker checks TurnProjection.
 * If a turn is active (started by TurnController from user_message),
 * it waits for turn_outcome to finalize. We send one to unblock it.
 */
const sendTurnOutcomeIfNeeded = (h: Effect.Effect.Success<typeof TestHarness>) =>
  Effect.gen(function* () {
    const events = h.events()
    const hasStarted = events.some(e => e.type === 'turn_started' && e.forkId === null)
    const hasOutcome = events.some(e => e.type === 'turn_outcome' && e.forkId === null)
    if (hasStarted && !hasOutcome) {
      const started = events.find(e => e.type === 'turn_started' && e.forkId === null) as any
      yield* h.send(mkTurnOutcomeEvent({ forkId: null, turnId: started.turnId, chainId: started.chainId }))
    }
  })

describe('compaction/worker-lifecycle', () => {
  it.effect('context_limit_hit triggers worker and emits compaction_prepared', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send({ ...largeUserMessage, messageId: 'w1' })
      yield* h.send(mkContextLimitHit())
      const ready = yield* h.wait.event('compaction_prepared', (e) => e.forkId === null)
      expect(ready.turn.assistant.text.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(workerLayer)))

  it.effect('worker finalizes to compaction_injected and clears gates', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send({ ...largeUserMessage, messageId: 'w2' })
      yield* h.send(mkContextLimitHit())
      yield* h.wait.event('compaction_prepared', (e) => e.forkId === null)
      yield* sendTurnOutcomeIfNeeded(h)
      yield* h.wait.event('compaction_injected', (e) => e.forkId === null)
      const compaction = yield* getCompaction(h)
      expect(compaction._tag).toBe('idle')
      expect(compaction.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(workerLayer)))

  it.effect('worker failure emits compaction_failed on non-retryable error', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send({ ...largeUserMessage, messageId: 'w3' })
      yield* h.send(mkContextLimitHit())
      const failed = yield* h.wait.event('compaction_failed', (e) => e.forkId === null)
      expect(failed.error.length).toBeGreaterThan(0)
      const compaction = yield* getCompaction(h)
      expect(compaction._tag).toBe('idle')
      expect(compaction.contextLimitBlocked).toBe(false)
      // Verify no compaction_injected was emitted
      const events = h.events()
      const completedEvents = events.filter((e) => e.type === 'compaction_injected')
      expect(completedEvents.length).toBe(0)
    }).pipe(Effect.provide(TestHarnessLive({
      workers: { compaction: true },
      // Empty response stream → "Empty compaction response" error → immediate failure (not retryable)
      model: { responses: [[
        { _tag: 'stream_end', reason: { _tag: 'completed', finishReason: 'stop' }, usage: null },
      ]] },
    }))))

  it.effect('idempotent trigger does not overlap cycles', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send({ ...largeUserMessage, messageId: 'w4' })
      yield* h.send(mkContextLimitHit())
      yield* h.send(mkContextLimitHit())
      yield* h.send(mkContextLimitHit())
      yield* h.wait.event('compaction_prepared', (e) => e.forkId === null)
      yield* sendTurnOutcomeIfNeeded(h)
      yield* h.wait.event('compaction_injected', (e) => e.forkId === null)

      const rootEvents = h.events().filter((e) => e.forkId === null)
      const starts = rootEvents.reduce<number[]>((acc, e, i) => e.type === 'compaction_started' ? [...acc, i] : acc, [])
      const terminals = rootEvents.reduce<number[]>((acc, e, i) => e.type === 'compaction_injected' ? [...acc, i] : acc, [])
      expect(starts.length).toBeGreaterThanOrEqual(1)
      expect(terminals.length).toBeGreaterThanOrEqual(1)

      // Verify no overlapping cycles
      for (let i = 0; i < starts.length; i++) {
        const nextStart = starts[i + 1] ?? Infinity
        const terminalAfterThisStart = terminals.find((t) => t > starts[i])
        expect(terminalAfterThisStart).toBeDefined()
        expect(terminalAfterThisStart!).toBeLessThan(nextStart)
      }

      // No compaction_failed events
      const failedEvents = h.events().filter((e) => e.type === 'compaction_failed')
      expect(failedEvents.length).toBe(0)
    }).pipe(Effect.provide(workerLayer)))

  it.effect('worker ordering emits compaction_prepared before compaction_injected', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send({ ...largeUserMessage, messageId: 'w5' })
      yield* h.send(mkContextLimitHit())
      const ready = yield* h.wait.event('compaction_prepared', (e) => e.forkId === null)
      yield* sendTurnOutcomeIfNeeded(h)
      const completed = yield* h.wait.event('compaction_injected', (e) => e.forkId === null)
      const events = h.events()
      const readyIndex = events.findIndex((e) => e.type === 'compaction_prepared' && e.forkId === null)
      const completedIndex = events.findIndex((e) => e.type === 'compaction_injected' && e.forkId === null)
      expect(ready.turn.assistant.text.length).toBeGreaterThan(0)
      expect(readyIndex).toBeGreaterThanOrEqual(0)
      expect(completedIndex).toBeGreaterThan(readyIndex)
    }).pipe(Effect.provide(workerLayer)))
})
