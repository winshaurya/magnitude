import { describe, it, expect, beforeEach } from "vitest"
import { Stream, Effect, Chunk } from "effect"
import { decode } from "../decode"
import { defaultClassifyStreamError } from "../../../errors/classify"
import type { ChatCompletionsStreamChunk } from "../../wire/chat-completions"
import type { ResponseStreamEvent } from "../../response/events"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkFromData(data: Partial<ChatCompletionsStreamChunk>): ChatCompletionsStreamChunk {
  return {
    id: data.id ?? "chatcmpl-test",
    object: data.object ?? "chat.completion.chunk",
    created: data.created ?? 1234567890,
    model: data.model ?? "test-model",
    choices: data.choices ?? [],
    usage: data.usage,
    error: data.error,
  } as ChatCompletionsStreamChunk
}

function textChunk(content: string): ChatCompletionsStreamChunk {
  return chunkFromData({
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })
}

function usageChunk(): ChatCompletionsStreamChunk {
  return chunkFromData({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  })
}

function errorChunk(
  message: string,
  type = "server_error",
  code = "stream_interrupted",
): ChatCompletionsStreamChunk {
  return chunkFromData({
    choices: [],
    error: { message, type, code, param: null },
  })
}

/** Collect all events from a stream synchronously. */
async function collectEvents<TStreamError>(
  events: Stream.Stream<ResponseStreamEvent<TStreamError>, never>,
): Promise<ResponseStreamEvent<TStreamError>[]> {
  const chunk = await Effect.runPromise(Stream.runCollect(events))
  return Chunk.toArray(chunk)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decode — mid-stream error envelope", () => {
  it("emits stream_end with error reason when chunk has error field", async () => {
    const chunks = Stream.fromIterable([
      textChunk("Hello, "),
      textChunk("world!"),
      errorChunk("upstream provider is unavailable", "server_error", "upstream_unavailable"),
    ])

    const { events } = decode(chunks, {
      classifyStreamError: defaultClassifyStreamError,
    })

    const result = await collectEvents(events)

    // Should see content before the error
    const messageStarts = result.filter((e) => e._tag === "message_start")
    const messageDeltas = result.filter((e) => e._tag === "message_delta")
    expect(messageStarts).toHaveLength(1)
    expect(messageDeltas).toHaveLength(2)
    expect(messageDeltas.map((e) => e.text)).toEqual(["Hello, ", "world!"])

    // The final event must be stream_end with error reason
    const streamEnd = result[result.length - 1]
    expect(streamEnd._tag).toBe("stream_end")
    if (streamEnd._tag === "stream_end") {
      expect(streamEnd.reason._tag).toBe("error")
      if (streamEnd.reason._tag === "error") {
        expect(streamEnd.reason.error._tag).toBe("TransportError")
      }
    }
  })

  it("transitions to DONE phase and ignores subsequent chunks", async () => {
    const chunks = Stream.fromIterable([
      textChunk("Hello"),
      errorChunk("stream interrupted", "server_error", "stream_interrupted"),
      textChunk("this should be ignored"),
      textChunk("this too"),
    ])

    const { events } = decode(chunks, {
      classifyStreamError: defaultClassifyStreamError,
    })

    const result = await collectEvents(events)

    // Only content before error and the stream_end should appear
    const messageDeltas = result.filter((e) => e._tag === "message_delta")
    expect(messageDeltas).toHaveLength(1)
    expect(messageDeltas[0].text).toBe("Hello")

    // No content after error
    const allDeltas = result.filter((e) => e._tag === "message_delta")
    expect(allDeltas).toHaveLength(1)

    // Final event is stream_end
    const streamEnd = result[result.length - 1]
    expect(streamEnd._tag).toBe("stream_end")
    if (streamEnd._tag === "stream_end") {
      expect(streamEnd.reason._tag).toBe("error")
    }
  })

  it("error envelope with missing optional fields still works", async () => {
    // errorChunk uses code="stream_interrupted" — also test minimal error shape
    const chunks = Stream.fromIterable([
      chunkFromData({
        choices: [],
        // Only required field: message; type, code, param all optional
        error: { message: "something went wrong" },
      } as Partial<ChatCompletionsStreamChunk> as ChatCompletionsStreamChunk),
    ])

    const { events } = decode(chunks, {
      classifyStreamError: defaultClassifyStreamError,
    })

    const result = await collectEvents(events)

    expect(result).toHaveLength(1)
    expect(result[0]._tag).toBe("stream_end")
    if (result[0]._tag === "stream_end") {
      expect(result[0].reason._tag).toBe("error")
      if (result[0].reason._tag === "error") {
        expect(result[0].reason.error._tag).toBe("TransportError")
      }
    }
  })

  it("normal stream completion still works when no error envelope is present", async () => {
    const chunks = Stream.fromIterable([
      textChunk("Hello, "),
      textChunk("world!"),
      usageChunk(),
    ])

    const { events } = decode(chunks, {
      classifyStreamError: defaultClassifyStreamError,
    })

    const result = await collectEvents(events)

    const streamEnd = result[result.length - 1]
    expect(streamEnd._tag).toBe("stream_end")
    if (streamEnd._tag === "stream_end") {
      expect(streamEnd.reason._tag).toBe("completed")
      expect(streamEnd.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      })
    }
  })

  it("error envelope with empty choices array works", async () => {
    const chunks = Stream.fromIterable([
      textChunk("partial response"),
      // Error chunk with choices:[] (same shape as usage chunks)
      errorChunk("server error mid-stream", "server_error", "internal_server_error"),
    ])

    const { events } = decode(chunks, {
      classifyStreamError: defaultClassifyStreamError,
    })

    const result = await collectEvents(events)

    const streamEnd = result[result.length - 1]
    expect(streamEnd._tag).toBe("stream_end")
    if (streamEnd._tag === "stream_end") {
      expect(streamEnd.reason._tag).toBe("error")
    }
  })
})
