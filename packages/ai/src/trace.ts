import { Context } from "effect"
import type { ChatCompletionsRequest } from "./wire/chat-completions"
import type { FinishReason } from "./response/events"
import type { ResponseUsage } from "./response/usage"
import type { ConnectionError } from "./errors/model-error"
import type { ProviderToolCallId } from "./prompt/ids"

// ---------------------------------------------------------------------------
// Trace types
// ---------------------------------------------------------------------------

export interface AssembledToolCall {
  readonly id: string
  readonly providerToolCallId: ProviderToolCallId
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface TokenLogprob {
  readonly token: string
  readonly logprob: number
  readonly topLogprobs: readonly { readonly token: string; readonly logprob: number }[]
}

export interface ModelCallTrace {
  readonly modelId: string
  readonly url: string
  readonly startedAt: string
  readonly durationMs: number
  readonly request: ChatCompletionsRequest
  readonly response: {
    readonly reasoning: string | null
    readonly text: string | null
    readonly toolCalls: readonly AssembledToolCall[]
    readonly finishReason: FinishReason | null
    readonly usage: ResponseUsage | null
    readonly logprobs: readonly TokenLogprob[] | null
  }
  readonly connectionError?: ConnectionError
}

// ---------------------------------------------------------------------------
// Trace listener service
// ---------------------------------------------------------------------------

export class TraceListener extends Context.Tag("TraceListener")<
  TraceListener,
  { readonly onTrace: (trace: ModelCallTrace) => void }
>() {}
