import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'
import { TestHarness, TestHarnessLive } from '../../src/test-harness/harness'
import {
  expectCompactionUnblocked,
  expectStableWorkingState,
  getCompaction,
  getTurn,
  mkCompactionInjected,
  mkCompactionFailed,
  mkCompactionReady,
  mkCompactionStarted,
  mkContextLimitHit,
  mkInterrupt,
  mkUserMessage,
  startReadyCompaction,
} from './helpers'

describe('compaction/working-state-gating', () => {
  it.effect('compaction_prepared sets compaction lifecycle to pendingInjection', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'wake up' }))
      yield* h.send(mkCompactionStarted({ forkId: null }))
      yield* h.send(mkCompactionReady())
      const compaction = yield* getCompaction(h)
      expect(compaction._tag).toBe('pendingInjection')
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('context_limit_hit sets contextLimitBlocked', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'wake up' }))
      yield* h.send(mkContextLimitHit())
      const compaction = yield* getCompaction(h)
      expect(compaction.contextLimitBlocked).toBe(true)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_injected clears both gates', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkContextLimitHit())
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionInjected())
      yield* expectCompactionUnblocked(h)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_failed clears contextLimitBlocked and resets to idle', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkContextLimitHit())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionFailed())
      const compaction = yield* getCompaction(h)
      expect(compaction.contextLimitBlocked).toBe(false)
      expect(compaction._tag).toBe('idle')
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('eventual unblock invariant: completed path clears gates', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkContextLimitHit())
      yield* startReadyCompaction(h)
      yield* h.send(mkCompactionInjected())
      const compaction = yield* getCompaction(h)
      expect(compaction.contextLimitBlocked).toBe(false)
      expect(compaction._tag).toBe('idle')
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('eventual unblock invariant: failed + interrupt path clears gates', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkContextLimitHit())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionFailed())
      yield* h.send(mkInterrupt())
      yield* expectCompactionUnblocked(h)
      yield* expectStableWorkingState(h)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('eventual unblock invariant: interrupt during pending finalization clears gates', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      const compaction = yield* getCompaction(h)
      expect(compaction._tag).not.toBe('idle')
      yield* h.send(mkInterrupt())
      yield* expectCompactionUnblocked(h)
    }).pipe(Effect.provide(TestHarnessLive())))
})
