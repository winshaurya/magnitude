/**
 * Magnitude Agent
 *
 * A minimal coding agent using event-core architecture.
 */

export type { StorageClient } from '@magnitudedev/storage'

// Agent
export { CodingAgent, createCodingAgentClient } from './coding-agent'
export type { CreateClientOptions } from './coding-agent'
export { fetchRoleProfiles, fetchPublicRoleProfiles, type RoleProfile } from './role-profiles'
export { fetchBalance, type BalanceResponse, type UsagePeriod, type FetchBalanceOptions } from './usage'

// Errors
export {
  classifyUnknownError,
  mapConnectionErrorToOutcome,
  mapStreamErrorToOutcome,
  present,
  type ErrorPresentation,
  type ErrorSurface,
  type ErrorSeverity,
  type ErrorCta,
  type ActionId,
} from './errors'

// Events
export type {
  AppEvent,
  SessionInitialized,
  SessionContext,
  GitContext,
  UserMessage,
  TurnStarted,
  TurnOutcomeEvent,
  ObservedResult,

  TurnOutcome,
  TurnYieldTarget,
  YieldTarget,
  TurnCompletion,
  TurnFeedback,
  TurnToolCall,
  StrategyId,
  ThinkingChunk,
  ToolResult,
  ToolDisplay,
  Interrupt,
  AutopilotMessageGenerated,
  AutopilotToggled,
  ToolApproved,
  ToolRejected,

  SkillActivated,

  Attachment,
  ImageAttachment,
} from './events'

// Agents
export type { RoleId } from './agents/role-validation'
export { isRoleId, isSpawnableRole, getSpawnableRoles, ROLE_IDS } from './agents/role-validation'
export type { AgentRoleDefinition } from './agents/registry'
export type { PolicyContext } from './agents/types'
export { getAgentDefinition, getForkInfo, registerAgentDefinition, clearAgentOverrides } from './agents/registry'

// Constants
export { PROSE_DELIM_OPEN, PROSE_DELIM_CLOSE, DEFAULT_CHAT_NAME, USER_BLUR_DEBOUNCE_MS } from './constants'

// Session Context Collection
export { collectSessionContext } from './util/collect-session-context'
export type { CollectSessionContextOptions } from './util/collect-session-context'

// Skills (loaded from @magnitudedev/skills)
export { loadSkills } from '@magnitudedev/skills'
export type { Skill } from '@magnitudedev/skills'

// Scratchpad
export * from './scratchpad'

// Projections
export { WindowProjection } from './window'
export type { WindowEntry, WindowEntrySource, ForkWindowState } from './window'
export type { QueuedEntry } from './window/inbox/types'

export { CompactionProjection } from './projections/compaction'
export type { CompactionState } from './projections/compaction'

export { HarnessStateProjection, getToolHandlesRecord } from './projections/harness-state'
export type { TurnState } from '@magnitudedev/harness'

export { TaskWorkerProjection } from './projections/task-worker'
export type {
  WorkerState,
  WorkerActivity,
  TaskWorkerSnapshot,
  TaskWorkerState,
} from './projections/task-worker'

export {
  DisplayProjection,
} from './projections/display'
export type {
  DisplayState,
  DisplayMessage,
  UserMessageDisplay,
  QueuedUserMessageDisplay,
  AssistantMessageDisplay,
  ThinkBlockMessage,
  ThinkBlockStep,
  CommunicationStep,
  SubagentStartedStep,
  SubagentFinishedStep,
  InterruptedMessage,
  ErrorDisplayMessage,
  ForkResultMessage,
  ForkActivityMessage,
  ForkActivityToolCounts,
  ApprovalRequestMessage,
  PendingInboundCommunicationDisplay,
} from './projections/display'

export { TurnProjection } from './projections/turn'
export type { ToolCall, TurnTrigger, PendingInboundCommunication, ForkTurnState } from './projections/turn'

export { AgentRoutingProjection } from './projections/agent-routing'
export type {
  AgentRoutingState,
  RoutingEntry,
  AgentMessageSignal,
  AgentResponseSignal,
} from './projections/agent-routing'
export { AgentStatusProjection } from './projections/agent-status'
export type {
  AgentInfo,
  AgentStatusState,
  AgentStatus,
  AgentCreatedSignal,
  AgentBecameIdleSignal,
  AgentBecameWorkingSignal,
} from './projections/agent-status'

export { OutboundMessagesProjection } from './projections/outbound-messages'
export type { OutboundMessagesState, OutboundMessageCompletedSignal } from './projections/outbound-messages'

export { SessionContextProjection } from './projections/session-context'
export type { SessionContextState } from './projections/session-context'


export { TaskGraphProjection, getPrimaryRootTask, getSessionTitleFromTaskGraph, canTransition, isTaskStatus } from './projections/task-graph'
export type { TaskGraphState, TaskRecord, TaskStatus, TaskWorkerInfo } from './projections/task-graph'

// Line-edit types
export type { EditDiff } from './util/line-edit'

// Execution
export { ExecutionManager } from './execution/types'
export type { ExecutionManagerService, ExecuteResult } from './execution/types'
// ExecutionManagerLive — xml-act paradigm, orphaned. Import directly from the file if needed.
export { PermissionRejection } from './execution/permission-rejection'

// Prompt Utilities
// TODO: Re-add tool docs generation when implemented
// export { generateToolDocs } from './tools/tool-docs'
// TODO: Re-add protocol export when implemented
// export { getProtocol } from './prompts/protocol'

// Tools
export { isToolKey, type ToolKey } from './tools/toolkits'
export type { ToolHandle } from './tools/tool-handle'
export type { ToolState } from './models'
export type { FileEditState, FileWriteState } from './models'
export { globalTools } from './tools/globals'
export { shellTool } from './tools/shell'
export { readTool, writeTool, editTool, treeTool, grepTool, fsTools } from './tools/fs'
// webSearchTool disabled — awaiting Exa reimplementation
export { webFetchTool } from './tools/web-fetch-tool'

export type { AgentStateReader } from './tools/fork'

// Workers
export { TurnController } from './workers/turn-controller'

export { AgentLifecycle } from './workers/agent-lifecycle'
export { LifecycleCoordinator } from './workers/lifecycle-coordinator'
export { Autopilot } from './workers/autopilot'
export { ApprovalWorker } from './workers/approval-worker'

export { SessionTitleWorker } from './workers/session-title-worker'

// Persistence
export { ChatPersistence, PersistenceError } from './persistence/chat-persistence-service'
export type {
  ChatPersistenceService,
  SessionMetadata,
} from './persistence/chat-persistence-service'


// Serialization (for persistence)
export {
  serializeEvent,
  serializeEvents,
  deserializeEvent,
  deserializeEvents,
  validateEventOrder,
  testEventRoundTrip
} from './serialization'
export type { SerializedEvent } from './serialization'

// Debug Introspection

// Types are still exported for CLI debug panel
export type { DebugSnapshot, ProjectionSnapshot, ContextUsage } from './projections/debug-introspection'

// Ambient config
export * from './ambient'

// Model resolution
export { AgentModelResolver, type AgentBoundModel } from './model/model-resolver'

// Execution usage types
export { type AgentCallUsage, fromResponseUsage } from './execution/types'

// Tracing
export { initTraceSession, writeTrace, getTraceSessionId } from '@magnitudedev/tracing'
export type { TraceSessionMeta, AgentCallTrace } from '@magnitudedev/tracing'
export { createTraceListenerLayer, makeNoopTraceListener, makeTestTraceListener } from './tracing'
export type { AgentTraceContext, TraceStore } from './tracing'
export type { UserPart, TextPart, ImagePart, ImageMediaType } from '@magnitudedev/ai'
export { textParts, textOf, hasImages, wrapTextParts } from './content'

// Image description (vision preprocessing for non-vision models)
export { configure as configureImageDescription, startImageDescription, cancelImageDescription, resolveImageDescriptions } from './util/describe-image'