import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestHarness, TestHarnessLive } from '../../src/test-harness/harness'
import {
  getCompaction,
  getTurn,
  mkCompactionStarted,
  mkCompactionReady,
  mkCompactionInjected,
  mkContextLimitHit,
  mkTurnStarted,
  mkTurnOutcomeEvent,
} from './helpers'

describe('compaction/lifecycle-timing', () => {
  it.effect('compacting state does not block turns (parallelism)', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())

      const compaction = yield* getCompaction(h)
      expect(compaction._tag).toBe('compacting')
      // contextLimitBlocked should be false when under hardCap
      expect(compaction.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('pendingInjection state reached from compaction_prepared', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())

      const compaction = yield* getCompaction(h)
      expect(compaction._tag).toBe('pendingInjection')
      // contextLimitBlocked depends on tokenEstimate vs hardCap, not FSM state alone.
      // With low tokenEstimate (test default), pendingInjection does not block.
      // In production, compaction only triggers when tokens are high, so this would be true.
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('context_limit_hit during compacting sets contextLimitBlocked (emergency)', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())

      const before = yield* getCompaction(h)
      expect(before._tag).toBe('compacting')
      expect(before.contextLimitBlocked).toBe(false)

      // Emergency: context_limit_hit forces blocking even during compaction
      yield* h.send(mkContextLimitHit())

      const after = yield* getCompaction(h)
      expect(after._tag).toBe('compacting')
      expect(after.contextLimitBlocked).toBe(true)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_prepared while turn in-flight defers finalization until turn completes', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      // Start a turn, then start compaction, then compaction becomes prepared
      yield* h.send(mkTurnStarted({ turnId: 't1', chainId: 'c1' }))
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())

      // Should be in pendingInjection — waiting for turn to finish
      const beforeTurnEnd = yield* getCompaction(h)
      expect(beforeTurnEnd._tag).toBe('pendingInjection')

      // Complete the turn
      yield* h.send(mkTurnOutcomeEvent({ turnId: 't1', chainId: 'c1' }))

      // Now finalize
      yield* h.send(mkCompactionInjected())

      const after = yield* getCompaction(h)
      expect(after._tag).toBe('idle')
      expect(after.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_prepared while idle finalizes immediately', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      // No turn in flight
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())

      // pendingInjection reached
      const ready = yield* getCompaction(h)
      expect(ready._tag).toBe('pendingInjection')

      // Can immediately complete (no turn to wait for)
      yield* h.send(mkCompactionInjected())

      const after = yield* getCompaction(h)
      expect(after._tag).toBe('idle')
      expect(after.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('finalize timing parity: immediate vs deferred reach same terminal state', () =>
    Effect.gen(function* () {
      // Immediate path: no turn in flight
      const hImmediate = yield* TestHarness
      yield* hImmediate.send(mkCompactionStarted())
      yield* hImmediate.send(mkCompactionReady())
      yield* hImmediate.send(mkCompactionInjected())
      const immediate = yield* getCompaction(hImmediate)

      expect(immediate._tag).toBe('idle')
      expect(immediate.contextLimitBlocked).toBe(false)
      expect(immediate.shouldCompact).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())),
  )

  it.effect('finalize timing parity: deferred path reaches same terminal state', () =>
    Effect.gen(function* () {
      // Deferred path: turn in flight during compaction
      const h = yield* TestHarness
      yield* h.send(mkTurnStarted({ turnId: 't1', chainId: 'c1' }))
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkTurnOutcomeEvent({ turnId: 't1', chainId: 'c1' }))
      yield* h.send(mkCompactionInjected())
      const deferred = yield* getCompaction(h)

      expect(deferred._tag).toBe('idle')
      expect(deferred.contextLimitBlocked).toBe(false)
      expect(deferred.shouldCompact).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())),
  )

  it.effect('repeated context_limit_hit is idempotent', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      yield* h.send(mkContextLimitHit())
      const after1 = yield* getCompaction(h)

      yield* h.send(mkContextLimitHit())
      const after2 = yield* getCompaction(h)

      yield* h.send(mkContextLimitHit())
      const after3 = yield* getCompaction(h)

      // All should have same state
      expect(after1.contextLimitBlocked).toBe(true)
      expect(after1.shouldCompact).toBe(true)
      expect(after2.contextLimitBlocked).toBe(after1.contextLimitBlocked)
      expect(after2.shouldCompact).toBe(after1.shouldCompact)
      expect(after3.contextLimitBlocked).toBe(after1.contextLimitBlocked)
      expect(after3.shouldCompact).toBe(after1.shouldCompact)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('terminal state is compaction_injected, not compaction_failed', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionInjected())

      const after = yield* getCompaction(h)
      expect(after._tag).toBe('idle')
      expect(after.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('turn can start and complete during compacting state', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      yield* h.send(mkCompactionStarted())
      const duringCompaction = yield* getCompaction(h)
      expect(duringCompaction._tag).toBe('compacting')
      expect(duringCompaction.contextLimitBlocked).toBe(false)

      // A turn can run concurrently
      yield* h.send(mkTurnStarted({ turnId: 't1', chainId: 'c1' }))
      yield* h.send(mkTurnOutcomeEvent({ turnId: 't1', chainId: 'c1' }))

      // Still compacting
      const stillCompacting = yield* getCompaction(h)
      expect(stillCompacting._tag).toBe('compacting')
    }).pipe(Effect.provide(TestHarnessLive())))
})