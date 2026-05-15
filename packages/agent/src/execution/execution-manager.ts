/**
 * ExecutionManager
 *
 * Owns per-fork lifecycle: init, dispose, fork, layer caching, observables.
 */

import * as path from 'path'
import { Effect, Layer } from 'effect'
import { ToolInterceptorTag, type ToolInterceptor } from './permission-gate'
import { Fork, Projection, WorkerBusTag, type WorkerBusService } from '@magnitudedev/event-core'
import type { AppEvent } from '../events'
import { isToolKey, type ToolKey } from '../tools/toolkits'

import { isRoleId, type RoleId } from '../agents/role-validation'
import { getAgentDefinition } from '../agents/registry'
import { buildPolicyInterceptor, type AgentResolver } from './permission-gate'
export { IDENTICAL_RESPONSE_BREAKER_THRESHOLD } from './types'
import { createApprovalState, ApprovalStateTag, type ApprovalStateService } from './approval-state'

import { AgentStateReaderTag, type AgentStateReader } from '../tools/fork'
import { AgentRegistryStateReaderTag, type AgentRegistryStateReader } from '../tools/agent-registry-reader'
import { buildCloneContext, buildSpawnContext } from '../prompts/fork-context'
import type { JsonSchema } from '@magnitudedev/llm-core'
import { ConversationStateReaderTag, type ConversationStateReader } from '../tools/memory-reader'
import { TaskGraphStateReaderTag, canCompleteRecord, getChildRecords, canAssignRecord, collectSubtreeRecords } from '../tools/task-reader'
import { ConversationProjection, type ConversationState } from '../projections/conversation'
import { createId } from '../util/id'
import { logger } from '@magnitudedev/logger'

import { AgentRoutingProjection, type AgentRoutingState } from '../projections/agent-routing'
import { AgentStatusProjection, type AgentStatusState, getAgentByForkId } from '../projections/agent-status'
import { TurnProjection, type ForkTurnState } from '../projections/turn'
import { SessionContextProjection, type SessionContextState } from '../projections/session-context'
import { TaskGraphProjection, type TaskGraphState } from '../projections/task-graph'

import type { RoleDefinition } from '@magnitudedev/roles'
import type { BoundObservable } from '../observables/types'
import { bindObservable } from '../observables/types'
import { ProjectionReaderTag, type ProjectionReader } from '../observables/projection-reader'
import { EphemeralSessionContextTag, PolicyContextProviderTag, type EphemeralSessionContext } from '../agents/types'
import { createPolicyContextProvider } from '../agents/policy-context'
import { ExecutionManager } from './types'
import type { ExecutionManagerService } from './types'
import type { ForkLayer } from './fork-layer'
import { WorkingDirectoryTag } from './working-directory'

import { ChatPersistence } from '../persistence/chat-persistence-service'

const { ForkContext } = Fork

type AgentDef = RoleDefinition


// =============================================================================
// Implementation
// =============================================================================

/**
 * Build the unified Effect layer for a fork — covers tool execution, interceptor, and emit.
 * Tools use reader services, interceptor uses PolicyContextProvider + ApprovalState.
 */
function makeForkLayers(
  forkId: string | null,
  roleId: string,

  sessionContextProjection: Projection.ProjectionInstance<SessionContextState>,
  agentProjection: Projection.ProjectionInstance<AgentRoutingState>,
  agentStatusProjection: Projection.ProjectionInstance<AgentStatusState>,
  workingStateProjection: Projection.ForkedProjectionInstance<ForkTurnState>,
  taskGraphProjection: Projection.ProjectionInstance<TaskGraphState>,

  conversationProjection: Projection.ProjectionInstance<ConversationState>,
  approvalState: ApprovalStateService,
  persistenceLayer: Layer.Layer<ChatPersistence, never, never>,
  policyInterceptor: ReturnType<typeof buildPolicyInterceptor>,

  cwd: string,
  scratchpadPath: string,
  ephemeralSessionContext: EphemeralSessionContext,
) {
  const agentRegistryStateReaderLayer = Layer.succeed(AgentRegistryStateReaderTag, {
    getState: () => agentStatusProjection.get
  } satisfies AgentRegistryStateReader)

  const conversationStateReaderLayer = Layer.succeed(ConversationStateReaderTag, {
    getState: () => conversationProjection.get
  } satisfies ConversationStateReader)

  const agentStateReaderLayer = Layer.succeed(AgentStateReaderTag, {
    getAgentState: () => agentStatusProjection.get,
    getAgent: (agentId: string) => Effect.map(agentStatusProjection.get, (state) => state.agents.get(agentId)),
  } satisfies AgentStateReader)

  const taskGraphReaderLayer = Layer.succeed(TaskGraphStateReaderTag, {
    getTask: (id) => Effect.map(taskGraphProjection.get, (s) => s.tasks.get(id)),
    getState: () => taskGraphProjection.get,
    getChildren: (id) => Effect.map(taskGraphProjection.get, (s) => getChildRecords(s, id)),
    canComplete: (id) => Effect.map(taskGraphProjection.get, (s) => canCompleteRecord(s, id)),
    canAssign: (id, assignee) => Effect.map(taskGraphProjection.get, (s) => canAssignRecord(s, id, assignee)),
    getSubtree: (id) => Effect.map(taskGraphProjection.get, (s) => collectSubtreeRecords(s, id)),
  })

  const policyCtxProvider = createPolicyContextProvider(
    forkId,
    cwd,
    scratchpadPath,
    ephemeralSessionContext,
    agentStatusProjection,
    workingStateProjection,
  )

  const providedInterceptor: ToolInterceptor = {
    beforeExecute: (ctx) =>
      policyInterceptor(ctx).pipe(
        Effect.provideService(ForkContext, { forkId, roleId }),
        Effect.provideService(PolicyContextProviderTag, policyCtxProvider),
        Effect.provideService(ApprovalStateTag, approvalState),
      ),
  }

  return Layer.mergeAll(
    Layer.succeed(ForkContext, { forkId, roleId }),

    agentRegistryStateReaderLayer,
    conversationStateReaderLayer,
    taskGraphReaderLayer,
    agentStateReaderLayer,


    Layer.succeed(ApprovalStateTag, approvalState),
    Layer.succeed(WorkingDirectoryTag, { cwd, scratchpadPath }),
    Layer.succeed(EphemeralSessionContextTag, ephemeralSessionContext),
    Layer.succeed(PolicyContextProviderTag, policyCtxProvider),
    Layer.succeed(ToolInterceptorTag, providedInterceptor),
    persistenceLayer,

    Layer.succeed(ProjectionReaderTag, {
      getAgentRouting: () => agentProjection.get,
      getAgentStatus: () => agentStatusProjection.get,
    } satisfies ProjectionReader),
  )
}

/**
 * Create the execution manager.
 */
const makeExecutionManager = Effect.gen(function* () {
  const ephemeralSessionContext = yield* EphemeralSessionContextTag
  // Per-fork cached layers (built during initFork, reused across turns)
  const forkLayers = new Map<string | null, ForkLayer>()
  const forkCwds = new Map<string | null, string>()
  const forkScratchpadPaths = new Map<string | null, string | undefined>()

  // Bound observables map
  const boundObservables = new Map<string | null, BoundObservable[]>()

  // Approval state for gated tool calls
  const approvalState = createApprovalState()
  // Maps forkId → roleId, populated when forks are created.
  const forkRoles = new Map<string, RoleId>()

  // Pre-built teardown effects (captured at initFork time with services already provided)
  const forkTeardowns = new Map<string, Effect.Effect<void>>()

  // Per-fork consecutive identical continue-response tracker
  const identicalContinueTracker = new Map<string | null, { lastResponseText: string; consecutiveCount: number }>()

  /**
   * Resolve the active agent definition for a fork.
   * Child forks use their fixed role. Root fork uses the orchestrator definition.
   */
  const resolveAgent: AgentResolver = (forkId) => {
    if (forkId !== null) {
      const roleId = forkRoles.get(forkId) ?? 'engineer'
      return getAgentDefinition(roleId)
    }
    return getAgentDefinition('leader')
  }

  // Build the policy interceptor (shared across all forks, resolves agent dynamically)
  const policyInterceptor = buildPolicyInterceptor(resolveAgent)

  function buildForkContext(params: { mode: string; prompt: string; outputSchema?: JsonSchema | undefined }) {
    return Effect.gen(function* () {
      if (params.mode === 'clone') {
        return buildCloneContext(params.prompt, params.outputSchema)
      }
      const proj = yield* SessionContextProjection.Tag
      const ctx = yield* Effect.map(proj.get, s => s.context)
      return buildSpawnContext(params.prompt, ctx, params.outputSchema)
    })
  }

  const service: ExecutionManagerService = {
    initFork: (forkId, roleId) => (Effect.gen(function* () {
      yield* WorkerBusTag<AppEvent>()

      const sessionContextProjection = yield* SessionContextProjection.Tag
      const agentProjection = yield* AgentRoutingProjection.Tag
      const agentStatusProjection = yield* AgentStatusProjection.Tag
      const workingStateProjection = yield* TurnProjection.Tag
      const taskGraphProjection = yield* TaskGraphProjection.Tag

      const conversationProjection = yield* ConversationProjection.Tag
      const persistence = yield* ChatPersistence
      const persistenceLayer = Layer.succeed(ChatPersistence, persistence)

      const sessionState = yield* sessionContextProjection.get
      if (!sessionState.context) {
        return yield* Effect.die(
          new Error('Session context not initialized. session_initialized must be processed before initFork().'),
        )
      }
      const cwd = sessionState.context.cwd
      const scratchpadPath = sessionState.context.scratchpadPath
      let layers = makeForkLayers(
        forkId,
        roleId,
        sessionContextProjection, agentProjection, agentStatusProjection,
        workingStateProjection, taskGraphProjection,
        conversationProjection,
        approvalState,
        persistenceLayer, policyInterceptor, cwd, scratchpadPath, ephemeralSessionContext,
      )
      forkCwds.set(forkId, cwd)
      forkScratchpadPaths.set(forkId, scratchpadPath)

      // Inject role-specific setup layer when the role defines a setup function
      const roleDef = getAgentDefinition(roleId)
      if (roleDef.setup && forkId) {
        const setupLayer = yield* roleDef.setup({ forkId, roleId, cwd, scratchpadPath })
        layers = Layer.merge(layers, setupLayer)
      }

      // Pre-build teardown effect (so disposeFork needs no requirements)
      if (forkId && roleDef.teardown) {
        const teardownEffect = roleDef.teardown({ forkId, roleId, cwd, scratchpadPath }) as Effect.Effect<void>
        forkTeardowns.set(forkId, teardownEffect)
      }

      // Store roleId for agent resolution
      if (forkId !== null) {
        forkRoles.set(forkId, roleId)
      }

      // Cache the layers
      forkLayers.set(forkId, layers)

      // Bind observables
      const agentDef = getAgentDefinition(roleId)
      const agentObservables = (agentDef.observables ?? []).map((obs) =>
        bindObservable(obs, (effect) => Effect.provide(effect, layers))
      )
      boundObservables.set(forkId, agentObservables)
    }) as Effect.Effect<void, never, Projection.ProjectionInstance<SessionContextState> | Projection.ProjectionInstance<AgentRoutingState> | Projection.ProjectionInstance<AgentStatusState> | Projection.ForkedProjectionInstance<ForkTurnState> | Projection.ProjectionInstance<ConversationState> | ChatPersistence | WorkerBusService<AppEvent>>),

    disposeFork: (forkId) => Effect.gen(function* () {
      // Run role teardown if defined
      const teardown = forkTeardowns.get(forkId)
      if (teardown) {
        yield* Effect.ignore(teardown)
        forkTeardowns.delete(forkId)
      }

      forkLayers.delete(forkId)
      forkCwds.delete(forkId)
      forkScratchpadPaths.delete(forkId)

      boundObservables.delete(forkId)
      forkRoles.delete(forkId)
      identicalContinueTracker.delete(forkId)
    }),

    fork: (params: {
      parentForkId: string | null
      name: string
      agentId: string
      prompt: string
      message: string
      outputSchema?: JsonSchema | undefined
      mode: 'clone' | 'spawn'
      role: RoleId
      taskId: string
    }) => Effect.gen(function* () {
      const forkId = createId()
      forkRoles.set(forkId, params.role)
      const workerBus = yield* WorkerBusTag<AppEvent>()
      const context = yield* buildForkContext(params)

      yield* service.initFork(forkId, params.role)

      const taskId = params.taskId.trim()
      if (taskId.length === 0) {
        return yield* Effect.die(new Error('ExecutionManager.fork requires a non-empty taskId'))
      }

      yield* workerBus.publish({
        type: 'agent_created',
        forkId,
        parentForkId: params.parentForkId,
        agentId: params.agentId,
        name: params.name,
        role: params.role,
        context,
        mode: params.mode,
        taskId,
        message: params.message,
        outputSchema: params.outputSchema,
      })

      return forkId
    }),

    approvalState,

    getObservables: (forkId) => boundObservables.get(forkId) ?? [],

    getForkLayer: (forkId) => forkLayers.get(forkId),
  }

  return service
})


// =============================================================================
// Layer
// =============================================================================

/**
 * ExecutionManager layer - no external requirements.
 * Services (projections) are accessed lazily at execution time.
 */
export const ExecutionManagerLive = Layer.scoped(
  ExecutionManager,
  makeExecutionManager
)
