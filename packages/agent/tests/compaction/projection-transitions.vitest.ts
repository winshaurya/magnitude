import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'
import { TestHarness, TestHarnessLive } from '../../src/test-harness/harness'
import {
  ROOT_FORK_ID,
  getCompaction,
  getMemory,
  mkCompactionInjected,
  mkCompactionFailed,
  mkCompactionReady,
  mkCompactionStarted,
  mkContextLimitHit,
  mkTurnCompleted,
  mkTurnStarted,
  mkUserMessage,
} from './helpers'

// =============================================================================
// Window Estimation Tests
// =============================================================================

describe('window/estimation', () => {
  it.effect('session_initialized seeds systemPromptTokens, messageTokens, and tokenEstimate', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const win = yield* getMemory(h)
      expect(win.systemPromptTokens).toBeGreaterThan(0)
      expect(win.messageTokens).toBeGreaterThan(0) // session_context entry
      expect(win.tokenEstimate).toBe(win.systemPromptTokens + win.messageTokens)
      expect(win.messages.length).toBe(1)
      expect(win.messages[0].type).toBe('session_context')
      expect(win.messages[0].estimatedTokens).toBeGreaterThan(0)
      expect(win.messages[0].estimatedTokens).toBe(win.messageTokens)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('user message increases messageTokens and tokenEstimate', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const before = yield* getMemory(h)
      yield* h.send(mkUserMessage({ text: 'A'.repeat(300) }))
      // Need a turn to flush the queue
      yield* h.send(mkTurnStarted({ turnId: 'turn-1', chainId: 'chain-1' }))
      const after = yield* getMemory(h)
      expect(after.messageTokens).toBeGreaterThan(before.messageTokens)
      expect(after.tokenEstimate).toBeGreaterThan(before.tokenEstimate)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('turn_outcome with inputTokens sets anchor', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'hello' }))
      yield* h.send(mkTurnStarted({ turnId: 'turn-a', chainId: 'chain-a' }))
      yield* h.send(mkTurnCompleted({
        turnId: 'turn-a',
        chainId: 'chain-a',
        inputTokens: 5000,
      }))
      const win = yield* getMemory(h)
      expect(win.lastAnchoredTotal).not.toBeNull()
      expect(win.lastAnchoredMessageTokens).not.toBeNull()
      // tokenEstimate should be based on anchor, not heuristic
      // anchor = inputTokens + turnEntryTokens
      expect(win.tokenEstimate).toBeGreaterThanOrEqual(5000)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('turn_outcome without inputTokens preserves heuristic estimate', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const before = yield* getMemory(h)
      yield* h.send(mkTurnStarted({ turnId: 'turn-b', chainId: 'chain-b' }))
      yield* h.send(mkTurnCompleted({
        turnId: 'turn-b',
        chainId: 'chain-b',
        inputTokens: null,
      }))
      const after = yield* getMemory(h)
      // Should still be heuristic-based (no anchor)
      expect(after.lastAnchoredTotal).toBeNull()
      // tokenEstimate should be systemPromptTokens + messageTokens
      expect(after.tokenEstimate).toBe(after.systemPromptTokens + after.messageTokens)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_injected recomputes messageTokens from surviving entries', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      // Add some content: user message + turn
      yield* h.send(mkUserMessage({ text: 'first message' }))
      yield* h.send(mkTurnStarted({ turnId: 'turn-c', chainId: 'chain-c' }))
      yield* h.send(mkTurnCompleted({ turnId: 'turn-c', chainId: 'chain-c', inputTokens: null }))

      yield* h.send(mkUserMessage({ text: 'second message' }))
      yield* h.send(mkTurnStarted({ turnId: 'turn-d', chainId: 'chain-d' }))
      yield* h.send(mkTurnCompleted({ turnId: 'turn-d', chainId: 'chain-d', inputTokens: null }))

      const before = yield* getMemory(h)
      const beforeCount = before.messages.length

      // Compact first message (index 1, after session_context at 0)
      yield* h.send(mkCompactionStarted({ compactedMessageCount: 1 }))
      yield* h.send(mkCompactionReady({ compactedMessageCount: 1 }))
      yield* h.send(mkCompactionInjected())

      const after = yield* getMemory(h)
      // Should have fewer messages + reflection block
      expect(after.messages.length).toBeLessThan(beforeCount + 1) // +1 for reflection
      // messageTokens recomputed from scratch
      const expectedTokens = after.messages.reduce((sum, e) => sum + e.estimatedTokens, 0)
      expect(after.messageTokens).toBe(expectedTokens)
      // tokenEstimate consistent
      expect(after.tokenEstimate).toBe(
        after.lastAnchoredTotal !== null && after.lastAnchoredMessageTokens !== null
          ? after.lastAnchoredTotal + (after.messageTokens - after.lastAnchoredMessageTokens)
          : after.systemPromptTokens + after.messageTokens
      )
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('per-entry estimatedTokens is set on all entry types', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      // session_context already exists
      yield* h.send(mkUserMessage({ text: 'test message' }))
      yield* h.send(mkTurnStarted({ turnId: 'turn-e', chainId: 'chain-e' }))
      yield* h.send(mkTurnCompleted({ turnId: 'turn-e', chainId: 'chain-e', inputTokens: null }))

      // Add compaction to get a compacted entry
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady({ compactedMessageCount: 1 }))
      yield* h.send(mkCompactionInjected())

      const win = yield* getMemory(h)
      for (const entry of win.messages) {
        expect(entry.estimatedTokens).toBeGreaterThan(0)
        expect(typeof entry.estimatedTokens).toBe('number')
      }
    }).pipe(Effect.provide(TestHarnessLive())))
})

// =============================================================================
// Compaction FSM / Policy Tests
// =============================================================================

describe('compaction/fsm-policy', () => {
  it.effect('initial state is idle with no blocking', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('idle')
      expect(state.shouldCompact).toBe(false)
      expect(state.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_started transitions idle → compacting', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('compacting')
      expect(state.shouldCompact).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_prepared transitions compacting → pendingInjection', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady({
        turn: {
          turnId: 'compaction-test',
          assistant: { _tag: 'AssistantMessage' as const, text: 'test summary', toolCalls: [] },
          toolResults: [],
          feedback: [],
          clean: true,
        },
        compactedMessageCount: 2,
      }))
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('pendingInjection')
      if (state._tag === 'pendingInjection') {
        expect(state.turn.assistant.text).toBe('test summary')
        expect(state.compactedMessageCount).toBe(2)
      }
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_injected transitions pendingInjection → idle', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionInjected())
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('idle')
      expect(state.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_failed resets to idle', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionFailed())
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('idle')
      expect(state.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('context_limit_hit forces contextLimitBlocked true', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkContextLimitHit())
      const state = yield* getCompaction(h)
      expect(state.contextLimitBlocked).toBe(true)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('context_limit_hit when idle sets shouldCompact true', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      expect((yield* getCompaction(h)).shouldCompact).toBe(false)
      yield* h.send(mkContextLimitHit())
      const state = yield* getCompaction(h)
      expect(state.shouldCompact).toBe(true)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compacting does not block when tokenEstimate < hardCap', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      // Default hardCap is 100000, initial tokenEstimate is small
      yield* h.send(mkCompactionStarted())
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('compacting')
      expect(state.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('interrupt during compaction resets to idle', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkCompactionStarted())
      yield* h.send({ type: 'interrupt', forkId: ROOT_FORK_ID })
      const state = yield* getCompaction(h)
      expect(state._tag).toBe('idle')
      expect(state.contextLimitBlocked).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('tokenEstimateChanged from Window drives shouldCompact', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      // Initially shouldCompact is false
      expect((yield* getCompaction(h)).shouldCompact).toBe(false)

      // After context_limit_hit + compaction cycle, verify shouldCompact resets
      yield* h.send(mkContextLimitHit())
      expect((yield* getCompaction(h)).shouldCompact).toBe(true)

      // Start and complete compaction
      yield* h.send(mkCompactionStarted())
      expect((yield* getCompaction(h)).shouldCompact).toBe(false)

      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionInjected())
      const final = yield* getCompaction(h)
      expect(final._tag).toBe('idle')
      // shouldCompact depends on whether tokenEstimate > softCap after compaction
      // With small test data, it should be false
      expect(final.shouldCompact).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_failed preserves shouldCompact when tokens still above softCap', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      // context_limit_hit when idle sets both contextLimitBlocked and shouldCompact to true
      yield* h.send(mkContextLimitHit())
      const afterLimitHit = yield* getCompaction(h)
      expect(afterLimitHit.contextLimitBlocked).toBe(true)
      expect(afterLimitHit.shouldCompact).toBe(true)
      expect(afterLimitHit._tag).toBe('idle')

      // Start compaction cycle — this is what caused the token pressure
      yield* h.send(mkCompactionStarted())
      expect((yield* getCompaction(h))._tag).toBe('compacting')

      yield* h.send(mkCompactionReady())
      expect((yield* getCompaction(h))._tag).toBe('pendingInjection')

      // compaction_failed transitions back to idle
      // BUG: currently hardcodes shouldCompact: false, preventing retry when tokens are still high
      // EXPECTED: shouldCompact stays true (tokens haven't improved), contextLimitBlocked clears
      yield* h.send(mkCompactionFailed())
      const final = yield* getCompaction(h)
      expect(final._tag).toBe('idle')
      expect(final.contextLimitBlocked).toBe(false)
      expect(final.shouldCompact).toBe(true) // should still want to retry compaction
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction_failed clears shouldCompact only when tokens are below softCap', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      // A failed compaction that didn't start from token pressure
      yield* h.send(mkCompactionStarted())
      yield* h.send(mkCompactionReady())
      yield* h.send(mkCompactionFailed())

      const final = yield* getCompaction(h)
      expect(final._tag).toBe('idle')
      expect(final.contextLimitBlocked).toBe(false)
      // No token pressure, so shouldCompact should be false
      expect(final.shouldCompact).toBe(false)
    }).pipe(Effect.provide(TestHarnessLive())))
})
