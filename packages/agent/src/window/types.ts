import type { UserPart, AssistantMessage } from '@magnitudedev/ai'
import type { ToolResultEntry } from '@magnitudedev/harness'
import type { TimelineEntry } from './inbox/types'
import type { StrategyId } from '../events'

// ---------------------------------------------------------------------------
// CompletedTurn / TurnFeedback
// ---------------------------------------------------------------------------

export type TurnFeedback =
  | { readonly kind: 'message_ack'; readonly destination: 'parent'; readonly chars: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'interrupted' }

export interface CompletedTurn {
  readonly turnId: string
  readonly assistant: AssistantMessage
  readonly toolResults: readonly ToolResultEntry[]
  readonly feedback: readonly TurnFeedback[]
  readonly clean: boolean
}

// ---------------------------------------------------------------------------
// Window entries
// ---------------------------------------------------------------------------

export type WindowEntrySource = 'user' | 'agent' | 'system'

export type WindowEntry =
  | { readonly type: 'session_context'; readonly source: 'system'; readonly content: UserPart[]; readonly estimatedTokens: number }
  | { readonly type: 'assistant_turn'; readonly source: 'agent'; readonly turn: CompletedTurn; readonly strategyId: StrategyId; readonly estimatedTokens: number }
  | { readonly type: 'compacted'; readonly source: 'system'; readonly content: UserPart[]; readonly estimatedTokens: number }
  | { readonly type: 'fork_context'; readonly source: 'system'; readonly content: UserPart[]; readonly estimatedTokens: number }
  | { readonly type: 'context'; readonly source: 'system'; readonly timeline: readonly TimelineEntry[]; readonly estimatedTokens: number }

export interface ForkWindowState {
  readonly messages: readonly WindowEntry[]
  readonly queuedTimeline: readonly QueuedTimelineEntry[]
  readonly currentTurnId: string | null
  readonly currentChainId: string | null
  readonly pendingPresenceText: string | null
  readonly nextQueueSeq: number
  // Parent message tracking (for feedback)
  readonly _activeMessageIsParent: boolean
  readonly _parentChars: number
  // Budget tracking
  readonly tokenEstimate: number
  readonly messageTokens: number
  readonly systemPromptTokens: number
  readonly lastAnchoredTotal: number | null
  readonly lastAnchoredMessageTokens: number | null
}

export interface QueuedTimelineEntry {
  readonly timestamp: number
  readonly seq: number
  readonly entry: TimelineEntry
  readonly coalesceKey?: string
}
