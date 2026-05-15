import { expect } from '@effect/vitest'
import { Effect } from 'effect'
import { createId } from '../../src/util/id'
import type { AppEvent, SessionContext } from '../../src/events'
import type { RoleId } from '../../src/agents/role-validation'
import { CHARS_PER_TOKEN_LOWER } from '../../src/constants'
import { CompactionProjection } from '../../src/projections/compaction'
import { WindowProjection } from '../../src/window'
import { TurnProjection } from '../../src/projections/turn'
import { TestHarness } from '../../src/test-harness/harness'

export const ROOT_FORK_ID: string | null = null

export type Harness = Effect.Effect.Success<typeof TestHarness>

let seq = 0
const now = () => 1_700_000_000_000 + ++seq

export const baseContext = (overrides: Partial<SessionContext> = {}): SessionContext => ({
  cwd: '/tmp/project',
  scratchpadPath: '/tmp/test-scratchpad',
  platform: 'macos',
  shell: '/bin/zsh',
  timezone: 'UTC',
  username: 'tester',
  fullName: null,
  git: null,
  folderStructure: '.',
  agentsFile: null,
  skills: null,
  ...overrides,
})

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN_LOWER)

export const mkUserMessage = (options: {
  forkId?: string | null
  text: string
  timestamp?: number
}): Extract<AppEvent, { type: 'user_message' }> => ({
  type: 'user_message',
  messageId: createId(),
  forkId: options.forkId ?? ROOT_FORK_ID,
  timestamp: options.timestamp ?? now(),
  content: [{ _tag: 'TextPart', text: options.text }],
  attachments: [],
  mode: 'text',
  synthetic: false,
  taskMode: false,
})

export const mkTurnStarted = (options: {
  forkId?: string | null
  turnId?: string
  chainId?: string
} = {}): Extract<AppEvent, { type: 'turn_started' }> => ({
  type: 'turn_started',
  forkId: options.forkId ?? ROOT_FORK_ID,
  turnId: options.turnId ?? createId(),
  chainId: options.chainId ?? createId(),
})

export const mkTurnOutcomeEvent = (overrides: Partial<Extract<AppEvent, { type: 'turn_outcome' }>> = {}): Extract<AppEvent, { type: 'turn_outcome' }> => ({
  type: 'turn_outcome',
  forkId: ROOT_FORK_ID,
  turnId: 'turn-1',
  chainId: 'chain-1',
  strategyId: 'xml-act',
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  providerId: null,
  modelId: null,
  outcome: { _tag: 'Completed', completion: { toolCallsCount: 0, finishReason: 'stop', feedback: [], yieldTarget: null } },

  ...overrides,
})

export const mkTurnCompleted = mkTurnOutcomeEvent

export const mkCompactionStarted = (overrides: Partial<Extract<AppEvent, { type: 'compaction_started' }>> = {}): Extract<AppEvent, { type: 'compaction_started' }> => ({
  type: 'compaction_started',
  forkId: ROOT_FORK_ID,
  compactedMessageCount: 0,
  ...overrides,
})

export const mkCompactionReady = (overrides: Partial<Extract<AppEvent, { type: 'compaction_prepared' }>> = {}): Extract<AppEvent, { type: 'compaction_prepared' }> => ({
  type: 'compaction_prepared',
  forkId: ROOT_FORK_ID,
  turn: {
    turnId: 'compaction-test',
    assistant: { _tag: 'AssistantMessage', text: 'compaction summary', toolCalls: [] },
    toolResults: [],
    feedback: [],
    clean: true,
  },
  compactResult: null,
  fallback: false,
  compactedMessageCount: 1,
  inputTokens: null,
  outputTokens: null,
  refreshedContext: null,
  ...overrides,
})

export const mkCompactionInjected = (overrides: Partial<Extract<AppEvent, { type: 'compaction_injected' }>> = {}): Extract<AppEvent, { type: 'compaction_injected' }> => ({
  type: 'compaction_injected',
  forkId: ROOT_FORK_ID,
  ...overrides,
})

export const mkCompactionFailed = (forkId: string | null = ROOT_FORK_ID, error = 'failure'): Extract<AppEvent, { type: 'compaction_failed' }> => ({
  type: 'compaction_failed',
  forkId,
  error,
  presentation: null,
})

export const mkContextLimitHit = (forkId: string | null = ROOT_FORK_ID, error = 'cap hit'): Extract<AppEvent, { type: 'context_limit_hit' }> => ({
  type: 'context_limit_hit',
  forkId,
  error,
})

export const mkInterrupt = (forkId: string | null = ROOT_FORK_ID): Extract<AppEvent, { type: 'interrupt' }> => ({
  type: 'interrupt',
  forkId,
})

export const getCompaction = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  h.projectionFork(CompactionProjection.Tag, forkId)

export const getTurn = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  h.projectionFork(TurnProjection.Tag, forkId)

export const getMemory = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  h.projectionFork(WindowProjection.Tag, forkId)

export const expectCompactionUnblocked = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  Effect.gen(function* () {
    const compaction = yield* getCompaction(h, forkId)
    const turn = yield* getTurn(h, forkId)
    expect(compaction.contextLimitBlocked).toBe(false)
    expect(turn._tag).toBe('idle')
    expect(turn.triggers.length).toBe(0)
  })

export const expectStableWorkingState = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  Effect.gen(function* () {
    const turn = yield* getTurn(h, forkId)
    expect(turn._tag).toBe('idle')
    expect(turn.triggers.length).toBe(0)
  })

export const startReadyCompaction = (h: Harness, forkId: string | null = ROOT_FORK_ID, readyOverrides: Partial<Extract<AppEvent, { type: 'compaction_prepared' }>> = {}) =>
  Effect.gen(function* () {
    yield* h.send(mkCompactionStarted({ forkId }))
    yield* h.send(mkCompactionReady({ forkId, ...readyOverrides }))
  })

export const completeCompaction = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  h.send(mkCompactionInjected({ forkId }))

export const createSubagentFork = (h: Harness, role: RoleId = 'engineer') =>
  Effect.gen(function* () {
    const agentId = createId()
    const forkId = createId()
    yield* h.send({
      type: 'agent_created',
      forkId,
      parentForkId: null,
      agentId,
      name: role,
      role,
      context: '',
      mode: 'spawn',
      taskId: createId(),
      message: 'spawn',
    })
    return forkId
  })

export const assertShouldTriggerBlocked = (h: Harness, forkId: string | null = ROOT_FORK_ID) =>
  Effect.gen(function* () {
    const turn = yield* getTurn(h, forkId)
    expect(turn._tag === 'idle' && turn.triggers.length > 0).toBe(false)
  })
