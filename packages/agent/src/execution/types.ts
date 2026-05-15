/**
 * Execution Types
 *
 * Types for the execution manager service interface
 * and the ExecutionManager Effect service tag.
 */

import { Effect, Data, Context, Layer } from 'effect'
import type { TurnOutcome } from '../events'
import type { ResponseUsage } from '@magnitudedev/ai'
import type { Projection, WorkerBusService } from '@magnitudedev/event-core'
import type { RoleId } from '../agents/role-validation'
import type { AgentRoutingState } from '../projections/agent-routing'
import type { AgentStatusState } from '../projections/agent-status'
import type { TaskGraphState } from '../projections/task-graph'
import type { ForkTurnState } from '../projections/turn'
import type { SessionContextState } from '../projections/session-context'
import type { ConversationState } from '../projections/conversation'
import type { ApprovalStateService } from './approval-state'
import type { ChatPersistence } from '../persistence/chat-persistence-service'
import type { BoundObservable } from '../observables/types'
import type { JsonSchema } from '@magnitudedev/llm-core'
import type { AppEvent } from '../events'
import type { ForkLayer } from './fork-layer'


// =============================================================================
// Turn Error
// =============================================================================

/**
 * Typed errors from turn execution.
 * Auth failures, LLM API errors, and stream read errors.
 */
export type TurnError = Data.TaggedEnum<{
  /** OAuth / API key validation failure */
  readonly AuthFailed: { readonly message: string; readonly cause?: unknown }
  /** LLM API returned an error (HTTP error, validation error, etc.) */
  readonly LLMFailed: { readonly message: string; readonly cause?: unknown }
  /** Error reading from the LLM response stream */
  readonly StreamFailed: { readonly message: string; readonly cause?: unknown }
}>

export const TurnError = Data.taggedEnum<TurnError>()

// =============================================================================
// Turn Result
// =============================================================================

/**
 * Agent-local usage type. Extends ai.ResponseUsage with optional cost fields.
 * Cost fields are nullable until a cost computation source is available.
 */
export interface AgentCallUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number | null
  readonly totalCost: number | null
}

/** Map ai.ResponseUsage to agent usage. */
export function fromResponseUsage(usage: ResponseUsage): AgentCallUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: null,
    totalCost: null,
  }
}

export interface TurnStrategyResult {
  readonly executeResult: ExecuteResult
  readonly usage: AgentCallUsage
}

// =============================================================================
// ExecutionManager Service
// =============================================================================

export const IDENTICAL_RESPONSE_BREAKER_THRESHOLD = 5

export interface ExecuteResult {
  readonly result: TurnOutcome
  readonly usage: {
    readonly inputTokens: number | null
    readonly outputTokens: number | null
    readonly cacheReadTokens: number | null
    readonly cacheWriteTokens: number | null
  } | null
}

export interface ExecutionManagerService {
  readonly initFork: (
    forkId: string | null,
    variant: RoleId
  ) => Effect.Effect<
    void,
    never,
    Projection.ProjectionInstance<SessionContextState> | Projection.ProjectionInstance<AgentRoutingState> | Projection.ProjectionInstance<AgentStatusState> | Projection.ForkedProjectionInstance<ForkTurnState> | Projection.ProjectionInstance<ConversationState> | ChatPersistence | WorkerBusService<AppEvent>
  >

  readonly disposeFork: (forkId: string) => Effect.Effect<void>

  readonly getObservables: (forkId: string | null) => BoundObservable[]

  /**
   * Returns the cached fork-scoped Layer (built by initFork). Includes
   * WorkingDirectory, ApprovalState, EphemeralSessionContext, all reader
   * services, ToolInterceptor, etc. Used by Cortex to provide tool-execution
   * context for the native paradigm.
   */
  readonly getForkLayer: (forkId: string | null) => ForkLayer | undefined

  readonly fork: (params: {
    parentForkId: string | null
    name: string
    agentId: string
    prompt: string
    message: string
    outputSchema?: JsonSchema | undefined
    mode: 'clone' | 'spawn'
    role: RoleId
    taskId: string
  }) => Effect.Effect<
    string,
    never,
    Projection.ProjectionInstance<SessionContextState> | Projection.ProjectionInstance<AgentRoutingState> | Projection.ProjectionInstance<AgentStatusState> | Projection.ForkedProjectionInstance<ForkTurnState> | Projection.ProjectionInstance<ConversationState> | ChatPersistence | WorkerBusService<AppEvent>
  >

  readonly approvalState: ApprovalStateService
}

export class ExecutionManager extends Context.Tag('ExecutionManager')<
  ExecutionManager,
  ExecutionManagerService
>() {}
