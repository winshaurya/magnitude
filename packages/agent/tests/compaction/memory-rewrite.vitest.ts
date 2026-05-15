import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'
import { TestHarness, TestHarnessLive } from '../../src/test-harness/harness'
import { baseContext, getMemory, mkCompactionInjected, mkCompactionReady, mkCompactionStarted, mkTurnCompleted, mkTurnStarted, mkUserMessage } from './helpers'

const sendAssistantText = (h: Effect.Effect.Success<typeof TestHarness>, turnId: string, text: string) =>
  Effect.gen(function* () {
    yield* h.send({ type: 'message_start', forkId: null, turnId, id: `${turnId}-msg`, destination: { kind: 'user' } })
    yield* h.send({ type: 'message_chunk', forkId: null, turnId, id: `${turnId}-msg`, text })
    yield* h.send({ type: 'message_end', forkId: null, turnId, id: `${turnId}-msg` })
  })

/** Helper to run a full compaction cycle with structured result */
const runStructuredCompaction = (
  h: Effect.Effect.Success<typeof TestHarness>,
  opts: {
    compactedMessageCount: number
    summary?: string
    reflection?: string
    refreshedContext?: any
  },
) =>
  Effect.gen(function* () {
    yield* h.send(mkCompactionStarted({ compactedMessageCount: opts.compactedMessageCount }))
    yield* h.send(mkCompactionReady({
      compactedMessageCount: opts.compactedMessageCount,
      isFallback: false,
      compactResult: {
        summary: opts.summary ?? 'compaction summary',
        reflection: opts.reflection ?? 'no issues',
        files: [],
      },
      refreshedContext: opts.refreshedContext ?? null,
    }))
    yield* h.send(mkCompactionInjected())
  })

describe('compaction/memory-rewrite', () => {
  it.effect('compaction_injected rewrites as [session_context, compacted, ...remaining]', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'first message' }))
      yield* h.send(mkUserMessage({ text: 'second message' }))
      yield* runStructuredCompaction(h, { compactedMessageCount: 2 })
      const memory = yield* getMemory(h)
      expect(memory.messages[0]?.type).toBe('session_context')
      expect(memory.messages[1]?.type).toBe('compacted')
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compaction summary text is preserved in compacted entry', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const summary = 'line 1\nline 2\nline 3'
      yield* runStructuredCompaction(h, {
        compactedMessageCount: 0,
        summary,
        reflection: 'test reflection',
      })
      const memory = yield* getMemory(h)
      const compacted = memory.messages.find(m => m.type === 'compacted')
      expect(compacted).toBeDefined()
      if (compacted?.type === 'compacted') {
        const text = compacted.content.map((p) => (p._tag === 'TextPart' ? p.text : '')).join('')
        expect(text).toContain(summary)
        expect(text).toContain('test reflection')
      }
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('remaining message ordering is preserved after rewrite', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      for (const id of [1, 2, 3]) {
        const turnId = `t-${id}`
        yield* h.send(mkTurnStarted({ turnId, chainId: 'chain-order' }))
        yield* sendAssistantText(h, turnId, `assistant-${id}`)
        yield* h.send(mkTurnCompleted({ turnId, chainId: 'chain-order' }))
      }
      const before = yield* getMemory(h)
      const compactedMessageCount = 2
      yield* runStructuredCompaction(h, { compactedMessageCount })
      const after = yield* getMemory(h)

      const beforeSuffix = before.messages.slice(1 + compactedMessageCount)
      // After rewrite: [session_context, compacted, ...remaining]
      const afterSuffix = after.messages.slice(2)
      expect(afterSuffix.length).toBe(beforeSuffix.length)
      for (let i = 0; i < beforeSuffix.length; i++) {
        expect(afterSuffix[i]).toBe(beforeSuffix[i])
      }
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('refreshedContext replaces existing session_context', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* runStructuredCompaction(h, {
        compactedMessageCount: 0,
        refreshedContext: baseContext({ cwd: '/tmp/new-cwd' }),
      })
      const memory = yield* getMemory(h)
      expect(memory.messages[0]?.type).toBe('session_context')
      if (memory.messages[0]?.type === 'session_context') {
        const text = memory.messages[0].content.map((p) => (p._tag === 'TextPart' ? p.text : '')).join('')
        expect(text.includes('/tmp/new-cwd')).toBe(true)
      }
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('null refreshedContext preserves prior session_context', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const before = yield* getMemory(h)
      yield* runStructuredCompaction(h, { compactedMessageCount: 0 })
      const after = yield* getMemory(h)
      expect(after.messages[0]).toBe(before.messages[0])
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('currentChainId resets on compaction_injected', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkTurnStarted({ turnId: 'turn-cid', chainId: 'chain-cid' }))
      yield* h.send(mkTurnCompleted({ turnId: 'turn-cid', chainId: 'chain-cid' }))
      yield* runStructuredCompaction(h, { compactedMessageCount: 0 })
      const memory = yield* getMemory(h)
      expect(memory.currentChainId).toBeNull()
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('session_context entry has non-zero estimatedTokens', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const memory = yield* getMemory(h)
      const sessionCtx = memory.messages[0]
      expect(sessionCtx?.type).toBe('session_context')
      expect(sessionCtx?.estimatedTokens).toBeGreaterThan(0)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('compacted entry has non-zero estimatedTokens', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* runStructuredCompaction(h, {
        compactedMessageCount: 0,
        summary: 'important reflection about the work done so far',
      })
      const memory = yield* getMemory(h)
      const compactionEntry = memory.messages.find(m => m.type === 'compacted')
      expect(compactionEntry).toBeDefined()
      expect(compactionEntry?.estimatedTokens).toBeGreaterThan(0)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('messageTokens equals sum of entry estimatedTokens after compaction', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'first message' }))
      yield* h.send(mkUserMessage({ text: 'second message' }))
      yield* runStructuredCompaction(h, { compactedMessageCount: 2 })
      const memory = yield* getMemory(h)
      const sumOfEntries = memory.messages.reduce((acc, entry) => acc + entry.estimatedTokens, 0)
      expect(memory.messageTokens).toBe(sumOfEntries)
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('tokenEstimate is recomputed after compaction_injected', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      yield* h.send(mkUserMessage({ text: 'first message' }))
      yield* h.send(mkUserMessage({ text: 'second message' }))
      // Flush queued messages by starting a turn
      yield* h.send(mkTurnStarted({ turnId: 'flush-turn', chainId: 'flush-chain' }))
      yield* h.send(mkTurnCompleted({ turnId: 'flush-turn', chainId: 'flush-chain' }))
      const before = yield* getMemory(h)
      const tokensBefore = before.tokenEstimate

      yield* runStructuredCompaction(h, {
        compactedMessageCount: 2,
        summary: 'short',
      })
      const after = yield* getMemory(h)

      // tokenEstimate should reflect the new window
      expect(after.tokenEstimate).toBe(after.systemPromptTokens + after.messageTokens)
      // Anchor should be cleared
      expect(after.lastAnchoredTotal).toBeNull()
    }).pipe(Effect.provide(TestHarnessLive())))

  it.effect('stale anchor is cleared on compaction_injected so tokenEstimate does not underflow', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness
      const before = yield* getMemory(h)
      const systemPromptTokens = before.systemPromptTokens

      // Establish an anchor: a completed turn that reports inputTokens
      const turnId = 'turn-anchored'
      yield* h.send(mkTurnStarted({ turnId, chainId: 'chain-anchored' }))
      yield* h.send({ type: 'message_start', forkId: null, turnId, id: `${turnId}-msg`, destination: { kind: 'user' } })
      yield* h.send({ type: 'message_end', forkId: null, turnId, id: `${turnId}-msg` })
      yield* h.send(mkTurnCompleted({ turnId, chainId: 'chain-anchored', inputTokens: 5000 }))
      const afterAnchor = yield* getMemory(h)
      expect(afterAnchor.lastAnchoredTotal).not.toBeNull()
      expect(afterAnchor.lastAnchoredMessageTokens).not.toBeNull()
      const anchoredMsgTokens = afterAnchor.lastAnchoredMessageTokens!

      // Add more content
      yield* h.send(mkUserMessage({ text: 'much longer message that increases messageTokens significantly' }))
      yield* h.send(mkUserMessage({ text: 'another message to push token count further' }))
      const beforeCompaction = yield* getMemory(h)
      expect(beforeCompaction.messageTokens).toBeGreaterThan(anchoredMsgTokens)

      // Run compaction that removes all pre-anchor content
      yield* runStructuredCompaction(h, {
        compactedMessageCount: beforeCompaction.messages.length - 1,
        summary: 'compacted everything before re-anchor',
      })
      const afterCompaction = yield* getMemory(h)

      // Anchor must be cleared
      expect(afterCompaction.lastAnchoredTotal).toBeNull()
      expect(afterCompaction.lastAnchoredMessageTokens).toBeNull()

      // tokenEstimate must be sane
      expect(afterCompaction.tokenEstimate).toBeGreaterThanOrEqual(systemPromptTokens)
      expect(afterCompaction.tokenEstimate).toBe(afterCompaction.systemPromptTokens + afterCompaction.messageTokens)
    }).pipe(Effect.provide(TestHarnessLive())))
})
