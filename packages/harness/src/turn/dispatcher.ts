import { Effect, Cause, Data, Layer, Stream, Schema } from "effect"
import type { ProviderToolCallId, ResponseStreamEvent, StreamError, ToolCallId, StreamingFieldParser, FinishReason, ValidationIssue } from "@magnitudedev/ai"
import type { StreamingPartial } from "@magnitudedev/ai"
import type { HarnessEvent, ToolError, ToolResult, TurnOutcome } from "../events"
import type { HarnessHooks, ExecuteHookContext } from "../hooks"
import type { Toolkit } from "../tool/toolkit"
import type { HarnessToolErased, ToolContext, StreamHook } from "../tool/tool"
import type { EngineState, ToolOutcome } from "./reducers"


// ── TurnAbort — planned abort control flow ────────────────────────────

/**
 * Typed error used to abort the dispatch event loop.
 *
 * When the dispatcher detects a terminal condition during tool execution
 * (error, rejection, defect), it emits all relevant lifecycle events first,
 * then fails with TurnAbort carrying the terminal outcome. Stream.runForEach
 * stops consuming — no more events are processed. The outer catch handler
 * extracts the outcome and emits TurnEnd.
 *
 * This is a planned abort, not a crash. It never crosses package boundaries.
 */
export class TurnAbort extends Data.TaggedError("TurnAbort")<{
  readonly outcome: TurnOutcome
}> {}

// ── Config ───────────────────────────────────────────────────────────

export interface DispatchConfig<TStreamError = StreamError, TDenial = unknown> {
  readonly events: Stream.Stream<ResponseStreamEvent<TStreamError>, never>
  readonly parsers: ReadonlyMap<ToolCallId, StreamingFieldParser>
  readonly toolkit: Toolkit
  readonly hooks?: HarnessHooks<unknown, TDenial>
  // Erased layer — createHarness enforces type coverage at compile time.
  readonly layer?: Layer.Layer<unknown>
  readonly initialEngineState?: EngineState
  readonly emit: (event: HarnessEvent) => Effect.Effect<void>
  readonly mapStreamError: (error: TStreamError) => TurnOutcome
}

// ── Per-tool-call accumulator ────────────────────────────────────────

interface ToolCallAccumulator {
  readonly toolCallId: ToolCallId
  readonly providerToolCallId: ProviderToolCallId
  readonly toolName: string
  readonly toolKey: string
  readonly streamState: unknown
  readonly streamHook: StreamHook<any, any, any, any> | undefined
}

// ── Dispatch ─────────────────────────────────────────────────────────

export function dispatch<TStreamError = StreamError, TDenial = unknown>(config: DispatchConfig<TStreamError, TDenial>): Effect.Effect<void> {
  const { toolkit, hooks, emit, initialEngineState } = config

  // Build lookup maps from toolkit
  const toolNameToKey = new Map<string, string>()
  const toolKeyToEntry = new Map<string, { tool: HarnessToolErased }>()
  for (const key of toolkit.keys) {
    const entry = toolkit.entries[key]
    const tool = entry.tool as HarnessToolErased
    toolNameToKey.set(tool.definition.name, key)
    toolKeyToEntry.set(key, { tool })
  }

  // Build cached outcomes map from initial engine state
  const cachedOutcomes = new Map<ToolCallId, ToolOutcome>()
  if (initialEngineState) {
    for (const [toolCallId, outcome] of initialEngineState.toolOutcomes) {
      cachedOutcomes.set(toolCallId, outcome)
    }
  }

  // Mutable dispatch state (scoped to this dispatch invocation)
  const accumulators = new Map<ToolCallId, ToolCallAccumulator>()
  let toolCallCount = 0

  // ── Provide layer to erased effect ───────────────────────────────

  // Erased-boundary layer provision — type coverage enforced by createHarness at compile time.
  function provideLayer<A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, never> {
    if (config.layer) {
      return Effect.provide(effect, config.layer) as Effect.Effect<A, E, never>
    }
    return effect as Effect.Effect<A, E, never>
  }

  // ── Emit helper for tool context ─────────────────────────────────

  function makeToolEmit(toolCallId: ToolCallId, providerToolCallId: ProviderToolCallId, toolName: string, toolKey: string) {
    return (value: unknown): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* emit({ _tag: "ToolEmission", toolCallId, providerToolCallId, toolName, toolKey, value })
        if (hooks?.onEmission) {
          yield* provideLayer(hooks.onEmission({ toolCallId, toolName, toolKey, value }))
        }
      })
  }

  // ── Tool execution pipeline ──────────────────────────────────────

  function executeTool(
    toolCallId: ToolCallId,
    providerToolCallId: ProviderToolCallId,
    toolName: string,
    toolKey: string,
    input: Record<string, unknown>,
  ): Effect.Effect<void, TurnAbort> {
    const lookup = toolKeyToEntry.get(toolKey)
    if (!lookup) {
      return Effect.fail(new TurnAbort({ outcome: { _tag: "EngineDefect", message: `Unknown tool key: ${toolKey}` } }))
    }
    const { tool } = lookup

    // Check cached outcome
    const cached = cachedOutcomes.get(toolCallId)
    if (cached && cached._tag === "Completed") {
      return Effect.gen(function* () {
        yield* emit({
          _tag: "ToolExecutionStarted",
          toolCallId, providerToolCallId, toolName, toolKey,
          input,
          cached: true,
        })
        yield* emit({
          _tag: "ToolExecutionEnded",
          toolCallId, providerToolCallId, toolName, toolKey,
          result: cached.result,
        })

        // afterExecute hook for cached results
        // Note: cached results carry ToolResultErased (denial: unknown) but the hook
        // signature expects ToolResult<unknown, ToolError, TDenial>. Cached results
        // are inherently untyped, so we upcast here.
        if (hooks?.afterExecute) {
          yield* provideLayer(hooks.afterExecute({ toolCallId, toolName, toolKey, input, result: cached.result as ToolResult<unknown, ToolError, TDenial> }))
        }

        // Fast-fail on cached error outcomes
        if (cached.result._tag === "Error") {
          return yield* Effect.fail(new TurnAbort({
            outcome: { _tag: "ToolExecutionError", toolCallId, providerToolCallId, toolName, toolKey, error: cached.result.error },
          }))
        }
      })
    }

    // beforeExecute hook
    const hookCtx: ExecuteHookContext = { toolCallId, toolName, toolKey, input }

    return Effect.gen(function* () {
      const decision = hooks?.beforeExecute
        ? yield* provideLayer(hooks.beforeExecute(hookCtx))
        : { _tag: "Proceed" as const }

      if (decision._tag === "Deny") {
        yield* emit({
          _tag: "ToolExecutionStarted",
          toolCallId, providerToolCallId, toolName, toolKey,
          input,
          cached: false,
        })
        const result: ToolResult = { _tag: "Denied", denial: decision.denial }
        yield* emit({ _tag: "ToolExecutionEnded", toolCallId, providerToolCallId, toolName, toolKey, result })
        return yield* Effect.fail(new TurnAbort({ outcome: { _tag: "GateRejected", toolCallId, providerToolCallId, toolName } }))
      }

      const effectiveInput = (decision._tag === "Proceed" && decision.modifiedInput !== undefined ? decision.modifiedInput : input) as Record<string, unknown>

      yield* emit({
        _tag: "ToolExecutionStarted",
        toolCallId, providerToolCallId, toolName, toolKey,
        input: effectiveInput,
        cached: false,
      })

      // Build ToolContext with working emit
      const toolCtx: ToolContext<unknown> = {
        emit: makeToolEmit(toolCallId, providerToolCallId, toolName, toolKey),
      }

      // Execute tool with layer provision
      const result: ToolResult = yield* Effect.gen(function* () {
        const toolEffect = tool.execute(effectiveInput, toolCtx)
        const provided = provideLayer(toolEffect)
        const output = yield* provided
        return { _tag: "Success" as const, output }
      }).pipe(
        Effect.catchAllCause((cause) => {
          const squashed = Cause.squash(cause)
          const error: ToolError = typeof squashed === 'object' && squashed !== null && 'message' in squashed
            ? squashed as ToolError
            : { message: String(squashed) }
          return Effect.succeed({ _tag: "Error" as const, error })
        }),
      )

      yield* emit({ _tag: "ToolExecutionEnded", toolCallId, providerToolCallId, toolName, toolKey, result })

      // afterExecute hook
      if (hooks?.afterExecute) {
        yield* provideLayer(hooks.afterExecute({ ...hookCtx, result }))
      }

      // Fast-fail on tool execution errors
      if (result._tag === "Error") {
        return yield* Effect.fail(new TurnAbort({
          outcome: { _tag: "ToolExecutionError", toolCallId, providerToolCallId, toolName, toolKey, error: result.error },
        }))
      }
    })
  }

  // ── Stream event processing ──────────────────────────────────────

  function processEvent(event: ResponseStreamEvent<TStreamError>): Effect.Effect<void, TurnAbort> {
    switch (event._tag) {
      case "thought_start":
        return emit({ _tag: "ThoughtStart", level: event.level })

      case "thought_delta":
        return emit({ _tag: "ThoughtDelta", text: event.text })

      case "thought_end":
        return emit({ _tag: "ThoughtEnd" })

      case "message_start":
        return emit({ _tag: "MessageStart" })

      case "message_delta":
        return emit({ _tag: "MessageDelta", text: event.text })

      case "message_end":
        return emit({ _tag: "MessageEnd" })

      case "tool_call_start": {
        const toolKey = toolNameToKey.get(event.toolName)
        if (!toolKey) {
          return Effect.fail(new TurnAbort({ outcome: { _tag: "EngineDefect", message: `Unknown tool name: ${event.toolName}` } }))
        }
        const entry = toolKeyToEntry.get(toolKey)
        if (!entry) {
          return Effect.fail(new TurnAbort({ outcome: { _tag: "EngineDefect", message: `No entry for tool key: ${toolKey}` } }))
        }
        toolCallCount++

        const acc: ToolCallAccumulator = {
          toolCallId: event.toolCallId,
          providerToolCallId: event.providerToolCallId,
          toolName: event.toolName,
          toolKey,
          streamState: entry.tool.stream?.initial,
          streamHook: entry.tool.stream,
        }
        accumulators.set(event.toolCallId, acc)

        return emit({
          _tag: "ToolInputStarted",
          toolCallId: event.toolCallId,
          providerToolCallId: event.providerToolCallId,
          toolName: event.toolName,
          toolKey,
        })
      }

      case "tool_call_field_start":
        return Effect.void

      case "tool_call_field_delta": {
        const acc = accumulators.get(event.toolCallId)
        if (!acc) return Effect.void

        const field = event.path[0] ?? ""

        return Effect.gen(function* () {
          yield* emit({
            _tag: "ToolInputFieldChunk",
            toolCallId: event.toolCallId,
            providerToolCallId: event.providerToolCallId,
            field,
            path: event.path,
            delta: event.delta,
          })

          // Invoke stream hook onInput if present — read partial from parser
          if (acc.streamHook) {
            const parser = config.parsers.get(event.toolCallId)
            if (parser) {
              const toolCtx: ToolContext<unknown> = {
                emit: makeToolEmit(acc.toolCallId, acc.providerToolCallId, acc.toolName, acc.toolKey),
              }
              const partial = parser.partial
              if (partial) {
                const newStreamState = yield* provideLayer(
                  acc.streamHook.onInput(partial, acc.streamState, toolCtx),
                ).pipe(
                  Effect.catchTag("StreamValidationError", (e) =>
                    Effect.gen(function* () {
                      const issue: ValidationIssue = { path: [], message: e.message }
                      yield* emit({
                        _tag: "ToolInputRejected",
                        toolCallId: event.toolCallId,
                        providerToolCallId: event.providerToolCallId,
                        toolName: acc.toolName,
                        toolKey: acc.toolKey,
                        issue,
                      })
                      // No formatting — the reducer produces ToolResultEntry from this event
                      return yield* Effect.fail(new TurnAbort({
                        outcome: { _tag: "ToolInputValidationFailure", toolCallId: acc.toolCallId, providerToolCallId: acc.providerToolCallId, toolName: acc.toolName, toolKey: acc.toolKey, issue },
                      }))
                    }),
                  ),
                )
                const current = accumulators.get(event.toolCallId)!
                accumulators.set(event.toolCallId, { ...current, streamState: newStreamState })
              }
            }
          }
        })
      }

      case "tool_call_field_end": {
        const acc = accumulators.get(event.toolCallId)
        if (!acc) return Effect.void

        const field = event.path[0] ?? ""

        return emit({
          _tag: "ToolInputFieldComplete",
          toolCallId: event.toolCallId,
          providerToolCallId: event.providerToolCallId,
          field,
          path: event.path,
          value: event.value,
        })
      }

      case "tool_call_ready": {
        const acc = accumulators.get(event.toolCallId)
        if (!acc) return Effect.void

        const parser = config.parsers.get(event.toolCallId)
        if (!parser || parser.decoded === null) {
          return Effect.fail(new TurnAbort({ outcome: { _tag: "EngineDefect", message: `No decoded input for ${event.toolCallId}` } }))
        }

        return Effect.gen(function* () {
          yield* emit({
            _tag: "ToolInputReady",
            toolCallId: acc.toolCallId,
            providerToolCallId: acc.providerToolCallId,
          })

          // Execute tool inline — sequential ordering required for dependent tools
          yield* executeTool(acc.toolCallId, acc.providerToolCallId, acc.toolName, acc.toolKey, parser.decoded!)
        })
      }

      case "stream_end": {
        return Effect.gen(function* () {
          let outcome: TurnOutcome | undefined

          switch (event.reason._tag) {
            case "completed": {
              outcome = mapFinishReasonToOutcome(event.reason.finishReason, toolCallCount)
              break
            }
            case "validation_failure": {
              const acc = accumulators.get(event.reason.toolCallId)!
              const toolEntry = toolKeyToEntry.get(acc.toolKey)!
              const parser = config.parsers.get(event.reason.toolCallId)
              const inputSchema = toolEntry.tool.definition.inputSchema
              const receivedInput = parser?.partial ?? ({} as StreamingPartial<Record<string, unknown>>)

              yield* emit({
                _tag: "ToolInputRejected",
                toolCallId: event.reason.toolCallId,
                providerToolCallId: event.reason.providerToolCallId,
                toolName: acc.toolName,
                toolKey: acc.toolKey,
                issue: event.reason.issue,
              })

              // No formatting — the reducer produces ToolResultEntry from this event

              outcome = {
                _tag: "ToolInputDecodeFailure",
                toolCallId: event.reason.toolCallId,
                providerToolCallId: event.reason.providerToolCallId,
                toolName: event.reason.toolName,
                issue: event.reason.issue,
                inputSchema,
                receivedInput,
              }
              break
            }
            case "error": {
              outcome = config.mapStreamError(event.reason.error)
              break
            }
          }

          yield* emit({
            _tag: "TurnEnd",
            outcome: outcome!,
            usage: event.usage ?? null,
          })
        })
      }

      default: {
        const _exhaustive: never = event
        return _exhaustive
      }
    }
  }

  // ── Main processing ──────────────────────────────────────────────

  return Stream.runForEach(config.events, processEvent).pipe(
    // Planned abort — emit TurnEnd with the abort's outcome
    Effect.catchTag("TurnAbort", (abort) =>
      emit({ _tag: "TurnEnd", outcome: abort.outcome, usage: null }),
    ),
    // Crash / defect / fiber interruption — emit TurnEnd with Interrupted
    Effect.catchAllCause(() =>
      emit({ _tag: "TurnEnd", outcome: { _tag: "Interrupted" }, usage: null }),
    ),
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function mapFinishReasonToOutcome(reason: FinishReason, toolCallCount: number): TurnOutcome {
  switch (reason) {
    case "stop":
    case "end_turn":
    case "tool_calls":
      return { _tag: "Completed", toolCallsCount: toolCallCount }
    case "length":
      return { _tag: "OutputTruncated" }
    case "content_filter":
      return { _tag: "ContentFiltered" }
    case "unknown":
    default:
      return { _tag: "Completed", toolCallsCount: toolCallCount }
  }
}
