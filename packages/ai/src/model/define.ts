import { Effect, Option, Stream } from "effect"
import type * as HttpClient from "@effect/platform/HttpClient"
import { Prompt } from "../prompt/prompt"
import type { ToolDefinition } from "../tools/tool-definition"
import type { AuthApplicator } from "../auth/auth"
import type { Codec } from "../codec/codec"
import type { ChatCompletionsRequest } from "../wire/chat-completions"
import type { HttpConnectionFailure, StreamFailure } from "../errors/failure"
import { executeHttpStream } from "../transport/stream"
import type { ModelCapabilities, ImagePlaceholderConfig } from "./capabilities"
import type { ModelSpec, ModelStreamResult } from "./model-spec"
import type { BoundModel } from "./bound-model"
import { normalizeVision } from "../prompt/normalize-vision"
import { TraceListener, type AssembledToolCall, type ModelCallTrace } from "../trace"
import type { FinishReason } from "../response/events"
import type { ResponseUsage } from "../response/usage"
import type { ConnectionError } from "../errors/model-error"
import type { ProviderToolCallId, ToolCallId } from "../prompt/ids"

// ---------------------------------------------------------------------------
// Model.define — internal factory used by protocol namespaces
// ---------------------------------------------------------------------------

export interface ModelDefineConfig<
  TCallOptions,
  TWireReq,
  TWireChunk,
  TConnectionError,
  TStreamError,
> {
  readonly modelId: string
  readonly endpoint: string
  readonly path: string
  readonly codec: Codec<TWireReq, TWireChunk>
  readonly buildWireRequest: (
    prompt: Prompt,
    tools: readonly ToolDefinition[],
    options: TCallOptions,
  ) => TWireReq
  readonly classifyConnectionError: (failure: HttpConnectionFailure) => TConnectionError
  readonly classifyStreamError: (failure: StreamFailure) => TStreamError
  readonly decodePayload: (raw: string) => Effect.Effect<TWireChunk, Error>
  readonly doneSignal?: string
  readonly capabilities?: ModelCapabilities
}

function joinUrl(endpoint: string, path: string): string {
  return endpoint.replace(/\/+$/, "") + path
}

export function modelDefine<
  TCallOptions,
  TWireReq extends ChatCompletionsRequest,
  TWireChunk,
  TConnectionError,
  TStreamError,
>(
  config: ModelDefineConfig<TCallOptions, TWireReq, TWireChunk, TConnectionError, TStreamError>,
): ModelSpec<TCallOptions, TConnectionError, TStreamError> {
  const url = joinUrl(config.endpoint, config.path)

  const spec: ModelSpec<TCallOptions, TConnectionError, TStreamError> = {
    modelId: config.modelId,
    endpoint: config.endpoint,
    capabilities: config.capabilities,

    bind: (args) => modelBind(spec, args.auth, args.defaults, { imagePlaceholders: args.imagePlaceholders }),


    _execute: (
      auth: AuthApplicator,
      prompt: Prompt,
      tools: readonly ToolDefinition[],
      options: TCallOptions,
    ): Effect.Effect<
      ModelStreamResult<TStreamError>,
      TConnectionError,
      HttpClient.HttpClient
    > => {
      const wireRequest = config.buildWireRequest(prompt, tools, options)

      const httpEffect = executeHttpStream({
        url,
        body: wireRequest,
        auth,
        decodePayload: config.decodePayload,
        doneSignal: config.doneSignal,
      })

      return Effect.gen(function* () {
        const listenerOption = yield* Effect.serviceOption(TraceListener)

        if (Option.isNone(listenerOption)) {
          // No listener — zero overhead path
          return yield* httpEffect.pipe(
            Effect.map((wireStream) =>
              config.codec.decode(wireStream, {
                tools,
                classifyStreamError: config.classifyStreamError,
                generateToolCallId: options.generateToolCallId,
              }),
            ),
            Effect.mapError((failure) => ({
              classified: config.classifyConnectionError(failure),
              raw: failure,
            })),
            Effect.tapError(({ classified, raw }) => {
              const ce = classified as ConnectionError
              return ce._tag === 'AuthFailed'
                ? Effect.logError('[AuthDiagnostic] Connection classified as AuthFailed', {
                    httpStatus: raw.status,
                    responseBody: raw.body,
                    classifiedMessage: ce.message,
                    modelId: config.modelId,
                    url,
                  })
                : Effect.void
            }),
            Effect.mapError(({ classified }) => classified),
          )
        }

        const listener = listenerOption.value
        const startedAt = new Date().toISOString()
        const startTime = performance.now()

        // Mutable accumulators for trace assembly
        let reasoning = ""
        let text = ""
        const toolCallMap = new Map<ToolCallId, { id: ToolCallId; providerToolCallId: ProviderToolCallId; name: string; args: Record<string, unknown> }>()
        let finishReason: FinishReason | null = null
        let usage: ResponseUsage | null = null

        const result = yield* httpEffect.pipe(
          Effect.map((wireStream) =>
            config.codec.decode(wireStream, {
              tools,
              classifyStreamError: config.classifyStreamError,
              generateToolCallId: options.generateToolCallId,
            }),
          ),
          Effect.mapError((failure) => {
            const connectionError = config.classifyConnectionError(failure)
            // Emit trace for connection errors
            const trace: ModelCallTrace = {
              modelId: config.modelId,
              url,
              startedAt,
              durationMs: performance.now() - startTime,
              request: wireRequest,
              response: {
                reasoning: null,
                text: null,
                toolCalls: [],
                finishReason: null,
                usage: null,
                logprobs: null,
              },
              connectionError: connectionError as ConnectionError,
            }
            listener.onTrace(trace)
            return { classified: connectionError, raw: failure }
          }),
          Effect.tapError(({ classified, raw }) => {
            const ce = classified as ConnectionError
            return ce._tag === 'AuthFailed'
              ? Effect.logError('[AuthDiagnostic] Connection classified as AuthFailed', {
                  httpStatus: raw.status,
                  responseBody: raw.body,
                  classifiedMessage: ce.message,
                  modelId: config.modelId,
                  url,
                })
              : Effect.void
          }),
          Effect.mapError(({ classified }) => classified),
        )

        // Wrap the event stream to accumulate trace data
        const tracedEvents = result.events.pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              switch (event._tag) {
                case "thought_delta":
                  reasoning += event.text
                  break
                case "message_delta":
                  text += event.text
                  break
                case "tool_call_start":
                  toolCallMap.set(event.toolCallId, { id: event.toolCallId, providerToolCallId: event.providerToolCallId, name: event.toolName, args: {} })
                  break
                case "tool_call_field_end": {
                  const tc = toolCallMap.get(event.toolCallId)
                  if (tc) {
                    if (event.path.length === 0) {
                      // Root object completion — replace args entirely
                      tc.args = event.value as Record<string, unknown>
                    } else {
                      // Build nested path
                      let target: any = tc.args
                      for (let i = 0; i < event.path.length - 1; i++) {
                        if (!(event.path[i] in target)) {
                          target[event.path[i]] = {}
                        }
                        target = target[event.path[i]]
                      }
                      target[event.path[event.path.length - 1]] = event.value
                    }
                  }
                  break
                }
                case "stream_end":
                  if (event.reason._tag === "completed") {
                    finishReason = event.reason.finishReason
                  }
                  usage = event.usage
                  break
              }
            }),
          ),
          Stream.ensuring(
            Effect.sync(() => {
              const assembledToolCalls: AssembledToolCall[] = Array.from(toolCallMap.values()).map(
                (tc) => ({ id: tc.id, providerToolCallId: tc.providerToolCallId, name: tc.name, arguments: tc.args }),
              )
              const trace: ModelCallTrace = {
                modelId: config.modelId,
                url,
                startedAt,
                durationMs: performance.now() - startTime,
                request: wireRequest,
                response: {
                  reasoning: reasoning.length > 0 ? reasoning : null,
                  text: text.length > 0 ? text : null,
                  toolCalls: assembledToolCalls,
                  finishReason,
                  usage,
                  logprobs: result.logprobs.length > 0 ? result.logprobs : null,
                },
              }
              listener.onTrace(trace)
            }),
          ),
        )

        return {
          events: tracedEvents,
          parsers: result.parsers,
          logprobs: result.logprobs,
        }
      })
    },
  }

  return spec
}

// ---------------------------------------------------------------------------
// Model.bind — public binding API
// ---------------------------------------------------------------------------

export function modelBind<
  TCallOptions,
  TConnectionError,
  TStreamError,
>(
  spec: ModelSpec<TCallOptions, TConnectionError, TStreamError>,
  auth: AuthApplicator,
  defaults?: Partial<TCallOptions>,
  options?: { imagePlaceholders?: ImagePlaceholderConfig },
): BoundModel<TCallOptions, TConnectionError, TStreamError> {
  return {
    spec,
    stream: (prompt, tools, callOptions?) => {
      const merged = { ...defaults, ...callOptions } as TCallOptions
      const normalizedPrompt = (options?.imagePlaceholders?.enabled && spec.capabilities?.vision === false)
        ? normalizeVision(prompt, options.imagePlaceholders.format)
        : prompt
      return spec._execute(auth, normalizedPrompt, tools, merged)
    },
  }
}

// ---------------------------------------------------------------------------
// Model namespace — public API
// ---------------------------------------------------------------------------

export const Model = {
  /** @internal — used by protocol namespaces */
  define: modelDefine,
  /** Bind a ModelSpec with auth and optional defaults to create a BoundModel */
  bind: modelBind,
} as const
