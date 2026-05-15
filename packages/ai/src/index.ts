// Namespaces
export { Model } from "./model/define"
export { NativeChatCompletions } from "./protocol/native-chat-completions"
export { Auth, type AuthApplicator } from "./auth/auth"
export { Option } from "./options/option"

// Core types
export type { ModelCapabilities, ImagePlaceholderConfig } from "./model/capabilities"
export type { ModelSpec, ModelStreamResult } from "./model/model-spec"
export type { BoundModel } from "./model/bound-model"
export type { OptionDef, InferCallOptions } from "./options/option"

// Prompt
export { Prompt, type TerminalMessages } from "./prompt/prompt"
export { PromptBuilder } from "./prompt/prompt-builder"
export type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  UserPart,
  ToolResultPart,
  Message,
  TerminalMessage,
} from "./prompt/messages"
export type { TextPart, ImagePart, ImageMediaType, ToolCallPart, JsonValue } from "./prompt/parts"
export { normalizeVision, imagePlaceholder } from "./prompt/normalize-vision"
export { createToolCallId } from "./prompt/ids"
export type { ToolCallId, ProviderToolCallId } from "./prompt/ids"

// Tools
export type { ToolDefinition } from "./tools/tool-definition"
export { defineTool } from "./tools/tool-definition"

// Response
export type { ResponseStreamEvent, ValidationIssue, FinishReason, StreamEndReason, StreamEnd } from "./response/events"
export type { ResponseUsage } from "./response/usage"

// Errors
export {
  AuthFailed,
  RateLimited,
  UsageLimitExceeded,
  ContextLimitExceeded,
  InvalidRequest,
  TransportError,
} from "./errors/model-error"
export type { ConnectionError, StreamError } from "./errors/model-error"
export { defaultClassifyConnectionError, defaultClassifyStreamError } from "./errors/classify"
export type { HttpConnectionFailure, StreamFailure } from "./errors/failure"

// Wire types
export type { ChatCompletionsRequest, ChatCompletionsStreamChunk } from "./wire/chat-completions"

// Codec
export type { Codec } from "./codec/codec"
export { nativeChatCompletionsCodec } from "./codec/native-chat-completions/index"

// Trace
export { TraceListener } from "./trace"
export type { ModelCallTrace, AssembledToolCall, TokenLogprob } from "./trace"

// Streaming field parser
export { createStreamingFieldParser } from "./streaming/field-parser"
export type { StreamingFieldParser } from "./streaming/field-parser"
export type { FieldEvent, StreamingPartial, StreamingLeaf } from "./streaming/types"
