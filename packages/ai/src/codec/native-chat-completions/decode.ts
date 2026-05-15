import { Cause, Stream } from "effect"
import type { Schema } from "effect"
import { createStreamingFieldParser, type StreamingFieldParser } from "../../streaming/field-parser"
import { createToolCallId, type ProviderToolCallId, type ToolCallId } from "../../prompt/ids"
import type { FinishReason, ResponseStreamEvent } from "../../response/events"
import type { ResponseUsage } from "../../response/usage"
import type { StreamFailure } from "../../errors/failure"
import type { ToolDefinition } from "../../tools/tool-definition"
import type { ChatCompletionsStreamChunk } from "../../wire/chat-completions"
import type { FieldEvent } from "../../streaming/types"
import type { TokenLogprob } from "../../trace"

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ToolCallState {
  readonly toolCallId: ToolCallId
  readonly providerToolCallId: ProviderToolCallId
  readonly toolName: string
  readonly parser: StreamingFieldParser
}

// ---------------------------------------------------------------------------
// Decoder phase — three states
//
//   STREAMING  → processing content, thoughts, tool calls
//   FINISHING  → received finish_reason, waiting for usage chunk
//   DONE       → emitted stream_end, terminal
// ---------------------------------------------------------------------------

type DecoderPhase =
  | { readonly _tag: 'streaming' }
  | { readonly _tag: 'finishing'; readonly finishReason: FinishReason }
  | { readonly _tag: 'done' }

interface DecoderState {
  readonly thoughtOpen: boolean
  readonly messageOpen: boolean
  readonly openToolCalls: ReadonlyMap<number, ToolCallState>
  readonly toolSchemas: ReadonlyMap<string, Schema.Schema.AnyNoContext>
  readonly phase: DecoderPhase
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInitialState(
  tools?: readonly ToolDefinition[],
): DecoderState {
  const toolSchemas = new Map<string, Schema.Schema.AnyNoContext>()
  if (tools) {
    for (const tool of tools) {
      toolSchemas.set(tool.name, tool.inputSchema)
    }
  }
  return {
    thoughtOpen: false,
    messageOpen: false,
    openToolCalls: new Map(),
    toolSchemas,
    phase: { _tag: 'streaming' },
  }
}

function toUsage(
  usage: NonNullable<ChatCompletionsStreamChunk["usage"]>,
): ResponseUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  }
}

function mapReason(reason: string | null | undefined): FinishReason {
  switch (reason) {
    case "stop":
    case "tool_calls":
    case "length":
    case "content_filter":
    case "end_turn":
      return reason
    default:
      return "unknown"
  }
}

/** Wrap FieldEvents from the parser with a toolCallId to produce ResponseStreamEvents. */
function wrapFieldEvents<TStreamError>(
  fieldEvents: readonly FieldEvent[],
  toolCallId: ToolCallId,
  providerToolCallId: ProviderToolCallId,
): ResponseStreamEvent<TStreamError>[] {
  return fieldEvents.map((fe) => {
    switch (fe._tag) {
      case "field_start":
        return { _tag: "tool_call_field_start" as const, toolCallId, providerToolCallId, path: fe.path }
      case "field_delta":
        return { _tag: "tool_call_field_delta" as const, toolCallId, providerToolCallId, path: fe.path, delta: fe.delta }
      case "field_end":
        return { _tag: "tool_call_field_end" as const, toolCallId, providerToolCallId, path: fe.path, value: fe.value }
    }
  })
}

// ---------------------------------------------------------------------------
// Chunk processing
// ---------------------------------------------------------------------------

function processChunk<TStreamError>(
  chunk: ChatCompletionsStreamChunk,
  state: DecoderState,
  parsers: Map<ToolCallId, StreamingFieldParser>,
  logprobs: TokenLogprob[],
  generateToolCallId: () => ToolCallId,
  classifyStreamError: (failure: StreamFailure) => TStreamError,
): readonly [DecoderState, readonly ResponseStreamEvent<TStreamError>[]] {
  const events: ResponseStreamEvent<TStreamError>[] = []
  let nextState = state

  // ── DONE: terminal, skip everything ────────────────────────────────────────
  if (nextState.phase._tag === 'done') {
    return [nextState, events]
  }

  // ── Server-side error envelope: terminate the stream with a typed error ────
  if (chunk.error) {
    const syntheticFailure: StreamFailure = {
      _tag: "ReadFailure",
      cause: new Error(chunk.error.message),
    }
    events.push({
      _tag: "stream_end",
      reason: { _tag: "error", error: classifyStreamError(syntheticFailure) },
      usage: null,
    })
    return [{ ...nextState, phase: { _tag: 'done' } }, events]
  }

  // ── Usage chunk: emit stream_end if we have a stored finishReason ──────────
  // OpenAI sends usage on a separate final chunk with choices: []
  if (chunk.usage) {
    if (nextState.phase._tag === 'finishing') {
      events.push({
        _tag: "stream_end",
        reason: { _tag: "completed", finishReason: nextState.phase.finishReason },
        usage: toUsage(chunk.usage),
      })
      return [{ ...nextState, phase: { _tag: 'done' } }, events]
    }
  }

  // ── FINISHING: waiting for usage only, skip content chunks ──────────────────
  if (nextState.phase._tag === 'finishing') {
    return [nextState, events]
  }

  // ── STREAMING: normal processing ───────────────────────────────────────────
  const choice = chunk.choices[0]
  if (!choice) {
    return [nextState, events]
  }

  // Accumulate logprobs from chunk
  if (choice.logprobs?.content) {
    for (const lp of choice.logprobs.content) {
      logprobs.push({
        token: lp.token,
        logprob: lp.logprob,
        topLogprobs: lp.top_logprobs.map((tp) => ({ token: tp.token, logprob: tp.logprob })),
      })
    }
  }

  const delta = choice.delta

  // Thought content
  if (delta.reasoning_content) {
    if (!nextState.thoughtOpen) {
      nextState = { ...nextState, thoughtOpen: true }
      events.push({ _tag: "thought_start", level: "medium" })
    }
    events.push({ _tag: "thought_delta", text: delta.reasoning_content })
  }

  // Message content
  if (delta.content) {
    if (nextState.thoughtOpen) {
      events.push({ _tag: "thought_end" })
      nextState = { ...nextState, thoughtOpen: false }
    }
    if (!nextState.messageOpen) {
      nextState = { ...nextState, messageOpen: true }
      events.push({ _tag: "message_start" })
    }
    events.push({ _tag: "message_delta", text: delta.content })
  }

  // Tool calls
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    if (nextState.thoughtOpen) {
      events.push({ _tag: "thought_end" })
      nextState = { ...nextState, thoughtOpen: false }
    }
    if (nextState.messageOpen) {
      events.push({ _tag: "message_end" })
      nextState = { ...nextState, messageOpen: false }
    }

    const calls = new Map(nextState.openToolCalls)

    for (const toolCallDelta of delta.tool_calls) {
      let toolCall = calls.get(toolCallDelta.index)

      if (!toolCall) {
        // Finalize all open tool calls with lower indices — they won't receive more deltas
        for (const [idx, openCall] of calls.entries()) {
          if (idx < toolCallDelta.index) {
            const fieldEvents = openCall.parser.end()
            events.push(...wrapFieldEvents<TStreamError>(fieldEvents, openCall.toolCallId, openCall.providerToolCallId))

            if (!openCall.parser.valid) {
              events.push({
                _tag: "stream_end",
                reason: {
                  _tag: "validation_failure",
                  toolCallId: openCall.toolCallId,
                  providerToolCallId: openCall.providerToolCallId,
                  toolName: openCall.toolName,
                  issue: openCall.parser.validationIssue!,
                },
                usage: null,
              })
              return [{ ...nextState, phase: { _tag: 'done' }, openToolCalls: new Map() }, events]
            }

            events.push({
              _tag: "tool_call_ready",
              toolCallId: openCall.toolCallId,
              providerToolCallId: openCall.providerToolCallId,
            })
            calls.delete(idx)
          }
        }

        const name = toolCallDelta.function?.name ?? ""
        const schema = nextState.toolSchemas.get(name)
        const parser = schema
          ? createStreamingFieldParser(schema)
          : createStreamingFieldParser()
        const toolCallId = generateToolCallId()
        const providerToolCallId = (toolCallDelta.id ?? toolCallId) as ProviderToolCallId
        toolCall = { toolCallId, providerToolCallId, toolName: name, parser }
        calls.set(toolCallDelta.index, toolCall)
        parsers.set(toolCallId, parser)
        events.push({
          _tag: "tool_call_start",
          toolCallId: toolCall.toolCallId,
          providerToolCallId: toolCall.providerToolCallId,
          toolName: toolCall.toolName,
        })
      } else if (toolCallDelta.function?.name && toolCall.toolName.length === 0) {
        const name = toolCallDelta.function.name
        const schema = nextState.toolSchemas.get(name)
        const parser = schema
          ? createStreamingFieldParser(schema)
          : createStreamingFieldParser()
        toolCall = { ...toolCall, toolName: name, parser }
        calls.set(toolCallDelta.index, toolCall)
        parsers.set(toolCall.toolCallId, parser)
      }

      if (toolCallDelta.function?.arguments) {
        const fieldEvents = toolCall.parser.push(toolCallDelta.function.arguments)
        events.push(...wrapFieldEvents<TStreamError>(fieldEvents, toolCall.toolCallId, toolCall.providerToolCallId))
      }
    }

    nextState = {
      ...nextState,
      openToolCalls: calls,
    }
  }

  // ── Finish reason ──────────────────────────────────────────────────────────
  if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
    // Close open blocks
    if (nextState.thoughtOpen) {
      events.push({ _tag: "thought_end" })
      nextState = { ...nextState, thoughtOpen: false }
    }
    if (nextState.messageOpen) {
      events.push({ _tag: "message_end" })
      nextState = { ...nextState, messageOpen: false }
    }

    // Finalize open tool calls
    for (const toolCall of nextState.openToolCalls.values()) {
      const fieldEvents = toolCall.parser.end()
      events.push(...wrapFieldEvents<TStreamError>(fieldEvents, toolCall.toolCallId, toolCall.providerToolCallId))

      if (!toolCall.parser.valid) {
        events.push({
          _tag: "stream_end",
          reason: {
            _tag: "validation_failure",
            toolCallId: toolCall.toolCallId,
            providerToolCallId: toolCall.providerToolCallId,
            toolName: toolCall.toolName,
            issue: toolCall.parser.validationIssue!,
          },
          usage: chunk.usage ? toUsage(chunk.usage) : null,
        })
        return [{ ...nextState, phase: { _tag: 'done' }, openToolCalls: new Map() }, events]
      }

      events.push({
        _tag: "tool_call_ready",
        toolCallId: toolCall.toolCallId,
        providerToolCallId: toolCall.providerToolCallId,
      })
    }

    const finishReason = mapReason(choice.finish_reason)

    if (chunk.usage) {
      // Usage on same chunk as finish_reason → emit stream_end immediately
      events.push({
        _tag: "stream_end",
        reason: { _tag: "completed", finishReason },
        usage: toUsage(chunk.usage),
      })
      nextState = { ...nextState, openToolCalls: new Map(), phase: { _tag: 'done' } }
    } else {
      // No usage yet → transition to FINISHING, wait for usage chunk
      nextState = { ...nextState, openToolCalls: new Map(), phase: { _tag: 'finishing', finishReason } }
    }
  }

  return [nextState, events]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function decode<E, TStreamError>(
  chunks: Stream.Stream<ChatCompletionsStreamChunk, E>,
  options: {
    tools?: readonly ToolDefinition[]
    classifyStreamError: (failure: StreamFailure | E) => TStreamError
    generateToolCallId?: () => ToolCallId
  },
): {
  readonly events: Stream.Stream<ResponseStreamEvent<TStreamError>, never>
  readonly parsers: ReadonlyMap<ToolCallId, StreamingFieldParser>
  readonly logprobs: TokenLogprob[]
} {
  const generateToolCallId = options.generateToolCallId ?? createToolCallId
  const parsers = new Map<ToolCallId, StreamingFieldParser>()
  const logprobs: TokenLogprob[] = []

  // Track final state for fallback stream_end emission
  let lastState: DecoderState = makeInitialState(options.tools)
  const tracked = Stream.mapAccum(
    chunks,
    makeInitialState(options.tools),
    (state, chunk): readonly [DecoderState, readonly ResponseStreamEvent<TStreamError>[]] => {
      const result = processChunk<TStreamError>(
        chunk,
        state,
        parsers,
        logprobs,
        generateToolCallId,
        options.classifyStreamError as (failure: StreamFailure) => TStreamError,
      )
      lastState = result[0]
      return result
    },
  )

  const flattened = Stream.flatMap(tracked, (events) => Stream.fromIterable(events))

  // Fallback: if stream closes while FINISHING (usage never arrived), emit stream_end with null usage
  const raw: Stream.Stream<ResponseStreamEvent<TStreamError>, E> = Stream.concat(
    flattened,
    Stream.suspend(() => {
      if (lastState.phase._tag === 'finishing') {
        const endEvent: ResponseStreamEvent<TStreamError> = {
          _tag: "stream_end",
          reason: { _tag: "completed", finishReason: lastState.phase.finishReason },
          usage: null,
        }
        return Stream.make(endEvent)
      }
      return Stream.empty
    }),
  )

  // Catch all errors, classify, and emit as stream_end { error }
  const withErrorHandling = Stream.catchAllCause(raw, (cause) => {
    const failure = Cause.failureOption(cause)
    let streamError: TStreamError
    if (failure._tag === "Some") {
      streamError = options.classifyStreamError(failure.value)
    } else {
      const squashed = Cause.squash(cause)
      const syntheticFailure: StreamFailure = {
        _tag: "ReadFailure",
        cause: squashed instanceof Error
          ? squashed
          : new Error("Stream terminated unexpectedly"),
      }
      streamError = options.classifyStreamError(syntheticFailure as StreamFailure | E)
    }
    const endEvent: ResponseStreamEvent<TStreamError> = {
      _tag: "stream_end",
      reason: { _tag: "error", error: streamError },
      usage: null,
    }
    return Stream.make(endEvent)
  })

  // stream_end is the terminal event — include it then stop
  const events = Stream.takeUntil(withErrorHandling, (event) => event._tag === "stream_end")

  return { events, parsers, logprobs }
}
