/**
 * Coding Agent
 *
 * A minimal coding agent that:
 * - Uses event-core architecture (projections, workers, signals)
 * - Uses native tool calling via TurnEngine
 * - Has a shell command tool for executing commands
 * - Supports session persistence and hydration
 */

import { Effect, Layer, Stream } from 'effect'
import { Agent } from '@magnitudedev/event-core'
import { HydrationContext, EventSinkTag } from '@magnitudedev/event-core'
import type { AppEvent, SessionContext } from './events'
import type { DebugSnapshot } from './projections/debug-introspection'

// Projections
import { SessionContextProjection } from './projections/session-context'
import { TurnProjection } from './projections/turn'
import { HarnessStateProjection } from './projections/harness-state'
import { WindowProjection } from './window'
import { SubagentActivityProjection } from './projections/subagent-activity'
import { DisplayProjection } from './projections/display'

import { AgentRoutingProjection } from './projections/agent-routing'
import { AgentStatusProjection } from './projections/agent-status'
import { TaskGraphProjection } from './projections/task-graph'
import { TaskWorkerProjection } from './projections/task-worker'
import { CompactionProjection } from './projections/compaction'

import { ConversationProjection } from './projections/conversation'
import { UserPresenceProjection } from './projections/user-presence'
import { OutboundMessagesProjection } from './projections/outbound-messages'
import { UserMessageResolutionProjection } from './projections/user-message-resolution'


// Workers
import { TurnController } from './workers/turn-controller'
import { Cortex } from './workers/cortex'
import { AgentLifecycle } from './workers/agent-lifecycle'
import { LifecycleCoordinator } from './workers/lifecycle-coordinator'
import { RetryController } from './workers/retry-controller'

// Runtime
import { EffectLoggerLayer } from './runtime/effect-logger'

import { Autopilot } from './workers/autopilot'
import { CompactionWorker } from './compaction/worker'
import { ApprovalWorker } from './workers/approval-worker'
import { isRoleId, type RoleId } from './agents/role-validation'
import { UserPresenceWorker } from './workers/user-presence-worker'
import { FileMentionResolver } from './workers/file-mention-resolver'
import { SessionTitleWorker } from './workers/session-title-worker'
import { FsLive } from './services/fs'

// Execution
import { ExecutionManager } from './execution/types'
import { ExecutionManagerLive } from './execution/execution-manager'

import { FetchHttpClient } from '@effect/platform'
import { registerApprovalBridge } from './execution/approval-bridge'

// Persistence
import { ChatPersistence } from './persistence/chat-persistence-service'

// Utils
import { collectSessionContext } from './util/collect-session-context'

// Engine layers

import { AgentModelResolverLive } from './model/model-resolver'

// Config & Auth
import { MagnitudeClient, createMagnitudeClient, isEnvFlagOn } from '@magnitudedev/magnitude-client'
import { configure as configureImageDescription } from './util/describe-image'
import { createTraceListenerLayer } from './tracing/tracing'
import type { StorageClient } from '@magnitudedev/storage'
import { initLogger, logger } from '@magnitudedev/logger'
import { initTraceSession } from '@magnitudedev/tracing'

import { EphemeralSessionContextTag } from './agents/types'
import { publishConfigFromCatalog } from './ambient/config-ambient'
import { loadSkills } from '@magnitudedev/skills'
import { SkillsAmbient, publishSkills } from './ambient/skills-ambient'
import { publishToolkit } from './ambient/toolkit-ambient'
import { leaderToolkit } from './tools/toolkits'

// =============================================================================
// Agent
// =============================================================================

export const CodingAgent = Agent.define<AppEvent>()({
  name: 'CodingAgent',

  projections: [
    SessionContextProjection,
    AgentRoutingProjection,
    AgentStatusProjection,
    TaskGraphProjection,
    CompactionProjection,
    TurnProjection,
    HarnessStateProjection,

    SubagentActivityProjection,
    OutboundMessagesProjection,
    UserMessageResolutionProjection,

    WindowProjection,
    TaskWorkerProjection,
    DisplayProjection,
    ConversationProjection,
    UserPresenceProjection,
  ],

  workers: [
    TurnController,
    Cortex,
    AgentLifecycle,
    LifecycleCoordinator,
    RetryController,
    Autopilot,
    CompactionWorker,
    ApprovalWorker,

    FileMentionResolver,

    UserPresenceWorker,
    SessionTitleWorker,
  ],

  expose: {
    signals: {
      restoreQueuedMessages: DisplayProjection.signals.restoreQueuedMessages,

      taskCreated: TaskGraphProjection.signals.taskCreated,
      taskCompleted: TaskGraphProjection.signals.taskCompleted,
      taskCancelled: TaskGraphProjection.signals.taskCancelled,
      taskStatusChanged: TaskGraphProjection.signals.taskStatusChanged
    },
    state: {
      display: DisplayProjection,
      harnessState: HarnessStateProjection,
      turn: TurnProjection,
      memory: WindowProjection,
      compaction: CompactionProjection,
      agentRouting: AgentRoutingProjection,
      agentStatus: AgentStatusProjection,
      taskGraph: TaskGraphProjection,
      taskWorker: TaskWorkerProjection,
    }
  }
})

// =============================================================================
// Client Factory
// =============================================================================

export interface CreateClientOptions {
  /**
   * Persistence service for session storage and hydration.
   */
  persistence: Layer.Layer<ChatPersistence, never, never>

  /**
   * Storage client for config, sessions, memory, and memory jobs.
   */
  storage: StorageClient<RoleId>

  /**
   * Enable LLM call tracing to ~/.magnitude/traces/
   */
  debug?: boolean

  /**
   * Provide a pre-built session context instead of collecting from the local environment.
   * Useful for evals / headless runs where the agent operates in a container.
   */
  sessionContext?: Omit<SessionContext, 'scratchpadPath'>

  /**
   * Magnitude API key. Falls back to MAGNITUDE_API_KEY env var.
   */
  magnitudeApiKey?: string

  /**
   * Magnitude API endpoint. Falls back to MAGNITUDE_ENDPOINT env var,
   * then to 'https://app.magnitude.dev/api/v1'.
   */
  magnitudeEndpoint?: string

  /**
   * Disable shell command classification safeguards for this runtime only.
   */
  disableShellSafeguards?: boolean

  /**
   * Disable working-directory boundary safeguards for this runtime only.
   */
  disableCwdSafeguards?: boolean

  /**
   * Session ID to use for trace recording. When provided with debug mode,
   * the trace folder uses this ID instead of a date-based string.
   */
  sessionId?: string
}

/**
 * Create a CodingAgent client with persistence.
 *
 * Loads events from persistence on startup:
 * - If events exist: hydrates projections from persisted state
 * - If no events: initializes a new session
 */
export async function createCodingAgentClient(options: CreateClientOptions) {

  // Construct Magnitude config from options / env vars
  const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)
  const apiKey = options.magnitudeApiKey ?? (useLocal ? process.env.MAGNITUDE_LOCAL_API_KEY : undefined) ?? process.env.MAGNITUDE_API_KEY
  if (!apiKey) throw new Error(
    useLocal
      ? 'MAGNITUDE_LOCAL_API_KEY (or MAGNITUDE_API_KEY) is required when MAGNITUDE_USE_LOCAL is set'
      : 'MAGNITUDE_API_KEY is required — set it via env var or pass magnitudeApiKey option'
  )

  const magnitudeEndpoint = options.magnitudeEndpoint ?? process.env.MAGNITUDE_ENDPOINT ?? (useLocal ? 'http://localhost:3000/api/v1' : 'https://app.magnitude.dev/api/v1')

  const magnitudeClientLayer = Layer.succeed(
    MagnitudeClient,
    createMagnitudeClient({ endpoint: magnitudeEndpoint, apiKey, sessionId: options.sessionId ?? undefined }),
  )

  // Configure image description module with the same endpoint/apiKey
  // so it can call util/image without duplicating env var resolution
  configureImageDescription({ endpoint: magnitudeEndpoint, apiKey })

  // Enable tracing in debug mode
  const traceSessionId = options.sessionId ?? new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')
  if (options.debug) {
    initTraceSession(traceSessionId, { cwd: process.cwd(), platform: process.platform, gitBranch: null })
  }

  const tracerLayer = options.debug
    ? createTraceListenerLayer({
        sessionId: traceSessionId,
        agentId: 'lead',
        forkId: null,
        callType: 'chat',
      })
    : undefined
  const ephemeralSessionContextLayer = Layer.succeed(EphemeralSessionContextTag, {
    disableShellSafeguards: options.disableShellSafeguards ?? false,
    disableCwdSafeguards: options.disableCwdSafeguards ?? false,
  })
  const baseLayer = Layer.mergeAll(
    EffectLoggerLayer,
    Layer.provide(ExecutionManagerLive, ephemeralSessionContextLayer),

    Layer.provide(AgentModelResolverLive(), magnitudeClientLayer),
    magnitudeClientLayer,

    FetchHttpClient.layer,
    FsLive,
    options.persistence,
  )
  const layer = tracerLayer ? Layer.merge(baseLayer, tracerLayer) : baseLayer
  const client = await CodingAgent.createClient(layer)

  try {
    const metadata = await client.runEffect(Effect.gen(function* () {
      const persistence = yield* ChatPersistence
      return yield* persistence.getSessionMetadata()
    }))
    initLogger(metadata.sessionId)
  } catch {}

  const flushPendingEvents = () => Effect.gen(function* () {
    const persistence = yield* ChatPersistence
    const eventSink = yield* EventSinkTag<AppEvent>()
    const pending = yield* eventSink.drainPending()
    if (pending.length > 0) {
      yield* persistence.persistNewEvents(pending)
    }
  })

  await client.runEffect(Effect.gen(function* () {
    const persistence = yield* ChatPersistence
    const hydrationContext = yield* HydrationContext
    const eventSink = yield* EventSinkTag<AppEvent>()

    // Bridge approval state into display and turn projections
    yield* registerApprovalBridge

    const events = yield* persistence.loadEvents()

    if (events.length === 0) {
      // New session
      const baseContext = options.sessionContext ?? (yield* Effect.tryPromise(async () => {
        try {
          return await collectSessionContext({
            cwd: process.cwd(),
            storage: options.storage,
          })
        } catch (err) {
          logger.error({ err }, 'Failed to collect session context')
          // Should not happen, but return minimal context so session can still initialize
          const cwd = process.cwd()
          return {
            cwd,
            platform: process.platform === 'darwin' ? 'macos' as const : process.platform === 'win32' ? 'windows' as const : 'linux' as const,
            shell: process.env.SHELL?.split('/').pop() || 'bash',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            username: process.env.USER || 'unknown',
            fullName: null,
            git: null,
            folderStructure: '(failed to collect folder structure)',
            agentsFile: null,
            skills: null,
          }
        }
      }))

      const sessionMetadata = yield* persistence.getSessionMetadata()
      const scratchpadPath = yield* Effect.promise(() =>
        options.storage.sessions.createScratchpad(sessionMetadata.sessionId)
      )
      const context: SessionContext = {
        ...baseContext,
        scratchpadPath,
      }

      yield* Effect.promise(() => client.send({
        type: 'session_initialized',
        forkId: null,
        context
      }))

      // Publish config from catalog
      yield* publishConfigFromCatalog(options.storage)

      // Load skills from standard directories
      const skills = yield* Effect.tryPromise(() => loadSkills(process.cwd()))
      yield* publishSkills(skills)
      yield* publishToolkit(leaderToolkit)

      // Persist the initial event immediately
      const pending = yield* eventSink.drainPending()
      if (pending.length > 0) {
        yield* persistence.persistNewEvents(pending)
      }

    } else {
      // Existing session — hydrate
      // Ensure scratchpad exists
      const sessionMetadata = yield* persistence.getSessionMetadata()
      yield* Effect.promise(() =>
        options.storage.sessions.createScratchpad(sessionMetadata.sessionId)
      )

      yield* hydrationContext.setHydrating(true)

      for (const event of events) {
        yield* Effect.promise(() => client.send(event))
      }

      yield* Effect.sleep('50 millis')
      yield* hydrationContext.setHydrating(false)

      const executionManager = yield* ExecutionManager
      const agentStatusProjection = yield* AgentStatusProjection.Tag
      const turnProjection = yield* TurnProjection.Tag

      // Create root sandbox (hydration happens lazily in execute())
      const sessionContextState = yield* (yield* SessionContextProjection.Tag).get
      const rootVariant: RoleId = 'leader'
      yield* executionManager.initFork(null, rootVariant)

      // Create execution resources for all known agents.
      const agentState = yield* agentStatusProjection.get
      for (const [, agent] of agentState.agents) {
        if (!isRoleId(agent.role)) {
          continue
        }
        yield* executionManager.initFork(agent.forkId, agent.role)
      }

      // Hydration recovery: detect forks that were in-flight when the process
      // died. If a fork is still active/interrupting after replay, synthesize
      // a cancelled terminal event to close turn lifecycle deterministically.
      for (const [, agent] of agentState.agents) {
        const forkTurnState = yield* turnProjection.getFork(agent.forkId)
        if (forkTurnState._tag === 'active' || forkTurnState._tag === 'interrupting') {
          yield* Effect.promise(() => client.send({
            type: 'turn_outcome',
            forkId: agent.forkId,
            turnId: forkTurnState.turnId,
            chainId: forkTurnState.chainId,
            strategyId: 'native',
            outcome: { _tag: 'Cancelled', reason: { _tag: 'WorkerKilled' } },
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            providerId: null,
            modelId: null,
          }))

          // Re-trigger the fork so TurnController picks it up and retries the turn.
          // Engine state is preserved (WorkerKilled path) so the harness can skip
          // tools that already executed before the crash.
          yield* Effect.promise(() => client.send({
            type: 'wake',
            forkId: agent.forkId,
          }))
        }
      }

      // Same recovery for root fork.
      const rootTurnState = yield* turnProjection.getFork(null)
      if (rootTurnState._tag === 'active' || rootTurnState._tag === 'interrupting') {
        yield* Effect.promise(() => client.send({
          type: 'turn_outcome',
          forkId: null,
          turnId: rootTurnState.turnId,
          chainId: rootTurnState.chainId,
          strategyId: 'native',
          outcome: { _tag: 'Cancelled', reason: { _tag: 'WorkerKilled' } },
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          providerId: null,
          modelId: null,
        }))

        // Re-trigger root fork for crash recovery
        yield* Effect.promise(() => client.send({
          type: 'wake',
          forkId: null,
        }))
      }

      // NOTE: AgentStatusProjection is the source of truth for agent identity, metadata, and execution state.
      // AgentRoutingProjection handles message routing only. forkId remains the execution handle used by forked projections/workers.

      // Publish config from catalog
      yield* publishConfigFromCatalog(options.storage)

      // Load skills from standard directories
      const skills = yield* Effect.tryPromise(() => loadSkills(process.cwd()))
      yield* publishSkills(skills)
      yield* publishToolkit(leaderToolkit)

      // Persist all recovery events immediately so reopening the same session
      // again won't re-run recovery for already-terminated forks.
      yield* flushPendingEvents()
    }
  }))

  // Debug subscription support
  const subscribeDebug = (forkId: string | null, callback: (snapshot: DebugSnapshot) => void): (() => void) => {
    let isActive = true

    const effect = Effect.gen(function* () {
      const { createDebugStream } = yield* Effect.promise(() => import('./projections/debug-introspection'))
      const stream = yield* createDebugStream(forkId)

      // Emit initial snapshot
      const { getDebugSnapshot } = yield* Effect.promise(() => import('./projections/debug-introspection'))
      const initial = yield* getDebugSnapshot(forkId)
      if (isActive) callback(initial)

      // Subscribe to stream
      yield* stream.pipe(
        Stream.takeWhile(() => isActive),
        Stream.runForEach((snapshot) =>
          Effect.sync(() => {
            if (isActive) callback(snapshot)
          })
        )
      )
    })

    client.runEffect(effect)

    return () => { isActive = false }
  }

  const originalDispose = client.dispose.bind(client)

  const dispose = async () => {
    try {
      // Best-effort flush of pending events to disk. If the session was mid-turn,
      // hydration recovery will detect non-stable forks on next startup and emit
      // interrupts to bring them to a clean terminal state.
      await client.runEffect(flushPendingEvents())
    } catch {}

    await originalDispose()
  }

  const refreshConfig = () => client.runEffect(publishConfigFromCatalog(options.storage))

  return {
    ...client,
    dispose,
    subscribeDebug,
    refreshConfig,
  }
}


