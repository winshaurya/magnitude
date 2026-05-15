import type { Effect, Schema } from "effect"
import type { ToolCallId } from "@magnitudedev/ai"
import type { HarnessEvent, ToolError, ToolResult } from "./events"

export interface ExecuteHookContext {
  readonly toolCallId: ToolCallId
  readonly toolName: string
  readonly toolKey: string
  readonly input: unknown
}

export type InterceptorDecision<TDenial = unknown> =
  | { readonly _tag: "Proceed"; readonly modifiedInput?: unknown }
  | { readonly _tag: "Deny"; readonly denial: TDenial }

export interface HarnessHooks<R = never, TDenial = unknown> {
  readonly beforeExecute?: (ctx: ExecuteHookContext) => Effect.Effect<InterceptorDecision<TDenial>, never, R>
  readonly afterExecute?: (ctx: ExecuteHookContext & { readonly result: ToolResult<unknown, ToolError, TDenial> }) => Effect.Effect<void, never, R>
  readonly onEvent?: (event: HarnessEvent) => Effect.Effect<void, never, R>
  readonly onEmission?: (ctx: {
    readonly toolCallId: ToolCallId
    readonly toolName: string
    readonly toolKey: string
    readonly value: unknown
  }) => Effect.Effect<void, never, R>
}
