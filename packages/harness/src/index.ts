// @magnitudedev/harness

// Streaming partial (self-contained, no tools dependency)
export type { StreamingLeaf, StreamingPartial, DeepPaths } from "./tool/streaming-partial"
export { applyFieldChunk, extractStreamingPartialValues } from "./tool/streaming-partial"

// State model
export type { Phase, BaseState, StateModel } from "./tool/state-model"
export { defineStateModel } from "./tool/state-model"

// Tool
export type { HarnessTool, ToolContext, StreamHook } from "./tool/tool"
export { StreamValidationError } from "./tool/tool"
export { defineHarnessTool } from "./tool/tool"

// Toolkit
export type { ToolkitEntry, Toolkit, ToolkitKeys, ToolkitTool, ToolkitState, ToolRequirements, ToolkitRequirements } from "./tool/toolkit"
export { defineToolkit, mergeToolkits } from "./tool/toolkit"

// Tool handle
export type { ToolHandle } from "./tool/tool-handle"
export { createToolHandle } from "./tool/tool-handle"

// Events
export type {
  ToolError,
  ToolResult,
  ToolResultEntry,
  SafetyStopReason,
  ToolInputDecodeFailure,
  TurnOutcome,
  ToolInputStarted,
  ToolInputFieldChunk,
  ToolInputFieldComplete,
  ToolInputReady,
  ToolInputRejected,
  ToolExecutionStarted,
  ToolExecutionEnded,
  ToolEmission,
  ThoughtStart,
  ThoughtDelta,
  ThoughtEnd,
  MessageStart,
  MessageDelta,
  MessageEnd,
  TurnEnd,
  ToolLifecycleEvent,
  HarnessEvent,
} from "./events"

// Hooks
export type { ExecuteHookContext, InterceptorDecision, HarnessHooks } from "./hooks"

// Reducers
export type { Reducer, TurnState, CanonicalTurnState, CanonicalAccumulator, EngineState, ToolOutcome, ToolHandleState } from "./turn/reducers"
export { createTurnReducer, projectCanonical, CanonicalAccumulatorReducer } from "./turn/reducers"

// Dispatcher
export type { DispatchConfig } from "./turn/dispatcher"
export { dispatch } from "./turn/dispatcher"

// Content building
export { ContentBuilder } from "./content"

// Rendering utilities (used by agent formatting layer)
export { isImageValue, toImagePart, isScalar, renderToolOutput, renderTagged } from "./formatting/helpers"
export { renderExpectedParams } from "./formatting/schema-render"
export type { ToolResultFormatter } from "./formatting/tool-result-formatter"
export { createToolResultFormatter } from "./formatting/tool-result-formatter"

// Harness
export type { HarnessConfig, Harness, LiveTurn, ReplayTurn } from "./turn/harness"
export { createHarness } from "./turn/harness"
