/**
 * HarnessStateProjection (Forked)
 *
 * Unified projection that delegates to the harness's pure `createTurnReducer`.
 * Replaces three separate projections:
 *   - CanonicalTurnProjection (canonical assistant message + tool results)
 *   - ReplayProjection (engine state for crash recovery)
 *   - ToolStateProjection (tool handle lifecycle state)
 *
 * Translates AppEvents → HarnessEvents and steps the composed reducer.
 */

import { Projection } from '@magnitudedev/event-core'
import {
  createTurnReducer,
  defineToolkit,
  type TurnState,
  type HarnessEvent,
  type ToolHandle,
  type Toolkit,
  type TurnOutcome as HarnessTurnOutcome,
} from '@magnitudedev/harness'
import type { ResponseUsage, ToolCallId, ProviderToolCallId } from '@magnitudedev/ai'
import type { AppEvent, TurnOutcomeEvent } from '../events'
import { ToolkitAmbient } from '../ambient/toolkit-ambient'

// ── Translation: AppEvent → HarnessEvent ─────────────────────────────

export function translateToHarnessEvent(event: AppEvent): HarnessEvent | null {
  switch (event.type) {
    case 'thinking_start':
      return { _tag: 'ThoughtStart', level: 'medium' }
    case 'thinking_chunk':
      return { _tag: 'ThoughtDelta', text: event.text }
    case 'thinking_end':
      return { _tag: 'ThoughtEnd' }
    case 'message_start':
      return { _tag: 'MessageStart' }
    case 'message_chunk':
      return { _tag: 'MessageDelta', text: event.text }
    case 'message_end':
      return { _tag: 'MessageEnd' }
    case 'tool_event':
      // ToolLifecycleEvent is a subset of HarnessEvent — pass through directly
      return event.event
    default:
      return null
  }
}

// ── Translation: Agent TurnOutcome → Harness TurnEnd ─────────────────

export function translateTurnOutcome(event: TurnOutcomeEvent): HarnessEvent {
  const agentOutcome = event.outcome
  let harnessOutcome: HarnessTurnOutcome

  switch (agentOutcome._tag) {
    case 'Completed':
      harnessOutcome = { _tag: 'Completed', toolCallsCount: agentOutcome.completion.toolCallsCount }
      break
    case 'Cancelled':
      harnessOutcome = { _tag: 'Interrupted' }
      break
    case 'OutputTruncated':
      harnessOutcome = { _tag: 'OutputTruncated' }
      break
    case 'SafetyStop':
      harnessOutcome = { _tag: 'SafetyStop', reason: agentOutcome.reason }
      break
    case 'ParseFailure': {
      const e = agentOutcome.error
      harnessOutcome = {
        _tag: 'ToolInputDecodeFailure',
        toolCallId: e.toolCallId as ToolCallId,
        providerToolCallId: e.providerToolCallId,
        toolName: e.toolName,
        issue: e.issue,
        inputSchema: e.inputSchema,
        receivedInput: e.receivedInput,
      }
      break
    }
    case 'ToolInputValidationFailure': {
      harnessOutcome = {
        _tag: 'ToolInputValidationFailure' as const,
        toolCallId: agentOutcome.toolCallId as ToolCallId,
        providerToolCallId: agentOutcome.providerToolCallId as ProviderToolCallId,
        toolName: agentOutcome.toolName,
        toolKey: agentOutcome.toolKey,
        issue: agentOutcome.issue,
      }
      break
    }
    case 'ToolExecutionError': {
      harnessOutcome = {
        _tag: 'ToolExecutionError' as const,
        toolCallId: agentOutcome.toolCallId as ToolCallId,
        providerToolCallId: agentOutcome.providerToolCallId as ProviderToolCallId,
        toolName: agentOutcome.toolName,
        toolKey: agentOutcome.toolKey,
        error: agentOutcome.error,
      }
      break
    }
    case 'GateRejected': {
      harnessOutcome = {
        _tag: 'GateRejected' as const,
        toolCallId: agentOutcome.toolCallId as ToolCallId,
        providerToolCallId: agentOutcome.providerToolCallId as ProviderToolCallId,
        toolName: agentOutcome.toolName,
      }
      break
    }
    default:
      // Agent-only errors (ConnectionFailure, ProviderNotReady, ContextWindowExceeded,
      // UnexpectedError) are filtered before this function is called.
      // If we get here, a new outcome was added without a mapping.
      throw new Error(`Unhandled agent outcome in translateTurnOutcome: ${(agentOutcome as any)._tag}`)
  }

  const usage: ResponseUsage | null =
    event.inputTokens != null || event.outputTokens != null
      ? {
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          cacheReadTokens: event.cacheReadTokens ?? 0,
          cacheWriteTokens: event.cacheWriteTokens ?? 0,
        }
      : null

  return {
    _tag: 'TurnEnd',
    outcome: harnessOutcome,
    usage,
  }
}

// ── Reducer cache (one per toolkit identity) ─────────────────────────

const reducerCache = new WeakMap<Toolkit, ReturnType<typeof createTurnReducer>>()

function getCachedReducer(toolkit: Toolkit): ReturnType<typeof createTurnReducer> {
  let r = reducerCache.get(toolkit)
  if (!r) {
    r = createTurnReducer(toolkit)
    reducerCache.set(toolkit, r)
  }
  return r
}

function stepEvent(fork: TurnState, event: AppEvent, toolkit: Toolkit): TurnState {
  const harnessEvent = translateToHarnessEvent(event)
  if (!harnessEvent) return fork
  return getCachedReducer(toolkit).step(fork, harnessEvent)
}

// ── Initial state (toolkit-independent) ──────────────────────────────

const emptyToolkit = defineToolkit({})
const emptyReducer = createTurnReducer(emptyToolkit)

// ── Projection ───────────────────────────────────────────────────────

export const HarnessStateProjection = Projection.defineForked<AppEvent, TurnState>()({
  name: 'HarnessState',
  ambients: [ToolkitAmbient] as const,
  initialFork: emptyReducer.initial,

  eventHandlers: {
    turn_started: ({ fork }) => ({
      // Reset canonical + handles for new turn.
      // Keep engine state for crash recovery (reset on turn_outcome).
      ...emptyReducer.initial,
      engine: fork.engine,
    }),

    thinking_start: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    thinking_chunk: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    thinking_end: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    message_start: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    message_chunk: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    message_end: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),
    tool_event: ({ event, fork, ambient }) => stepEvent(fork, event, ambient.get(ToolkitAmbient)),

    turn_outcome: ({ event, fork, ambient }) => {
      // Agent-only errors have no harness semantics — don't step the reducer.
      // The harness is generic and shouldn't know about agent-specific failure modes.
      // event.outcome remains the source of truth for what went wrong.
      const agentOnlyErrors = ['ConnectionFailure', 'ProviderNotReady', 'ContextWindowExceeded', 'UnexpectedError']
      if (agentOnlyErrors.includes(event.outcome._tag)) {
        return {
          ...fork,
          engine: { ...emptyReducer.initial.engine, stopped: true },
        }
      }

      // Harness-native outcomes: translate and step the reducer
      const toolkit = ambient.get(ToolkitAmbient)
      const harnessEvent = translateTurnOutcome(event)
      const stepped = getCachedReducer(toolkit).step(fork, harnessEvent)

      // Preserve engine state when turn was killed by process crash —
      // this allows the recovery turn to skip already-executed tools.
      const isProcessCrash = event.outcome._tag === 'Cancelled'
        && event.outcome.reason._tag === 'WorkerKilled'

      return {
        ...stepped,
        engine: isProcessCrash ? fork.engine : emptyReducer.initial.engine,
      }
    },

    interrupt: ({ fork }) => {
      // Interrupt non-terminal tool handles.
      // Can't use the composed reducer here because the harness has no standalone
      // "interrupt" event — it handles interrupts via TurnEnd { Interrupted }.
      // But we haven't received TurnEnd yet at interrupt time.
      const handles = new Map(fork.handles.handles)
      for (const [id, handle] of handles) {
        const phase = handle.state.phase
        if (phase !== 'completed' && phase !== 'error' && phase !== 'rejected') {
          handles.set(id, handle.interrupt())
        }
      }
      return { ...fork, handles: { handles } }
    },
  },
})

// ── Helpers for consumers ────────────────────────────────────────────

/** Convert the handles Map to a Record for consumers that expect Record<string, ToolHandle> */
export function getToolHandlesRecord(state: TurnState): { readonly [callId: string]: ToolHandle } {
  return Object.fromEntries(state.handles.handles)
}
