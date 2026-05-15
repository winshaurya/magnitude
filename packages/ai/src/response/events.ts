import type { ProviderToolCallId, ToolCallId } from "../prompt/ids"
import type { JsonValue } from "../prompt/parts"
import type { ResponseUsage } from "./usage"

export interface ValidationIssue {
  readonly path: readonly PropertyKey[]
  readonly message: string
}

export type FinishReason = "stop" | "tool_calls" | "end_turn" | "length" | "content_filter" | "unknown"

export type StreamEndReason<TStreamError> =
  | { readonly _tag: "completed"; readonly finishReason: FinishReason }
  | { readonly _tag: "validation_failure"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId; readonly toolName: string; readonly issue: ValidationIssue }
  | { readonly _tag: "error"; readonly error: TStreamError }

export type StreamEnd<TStreamError> = {
  readonly _tag: "stream_end"
  readonly reason: StreamEndReason<TStreamError>
  readonly usage: ResponseUsage | null
}

export type ResponseStreamEvent<TStreamError> =
  | { readonly _tag: "thought_start"; readonly level: "low" | "medium" | "high" }
  | { readonly _tag: "thought_delta"; readonly text: string }
  | { readonly _tag: "thought_end" }
  | { readonly _tag: "message_start" }
  | { readonly _tag: "message_delta"; readonly text: string }
  | { readonly _tag: "message_end" }
  | { readonly _tag: "tool_call_start"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId; readonly toolName: string }
  | { readonly _tag: "tool_call_field_start"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId; readonly path: readonly string[] }
  | { readonly _tag: "tool_call_field_delta"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId; readonly path: readonly string[]; readonly delta: string }
  | { readonly _tag: "tool_call_field_end"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId; readonly path: readonly string[]; readonly value: JsonValue }
  | { readonly _tag: "tool_call_ready"; readonly toolCallId: ToolCallId; readonly providerToolCallId: ProviderToolCallId }
  | StreamEnd<TStreamError>
