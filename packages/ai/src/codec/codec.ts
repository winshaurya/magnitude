import type { Stream } from "effect"
import type { StreamFailure } from "../errors/failure"
import type { ToolCallId } from "../prompt/ids"
import type { ToolDefinition } from "../tools/tool-definition"
import { Prompt } from "../prompt/prompt"
import type { ResponseStreamEvent } from "../response/events"
import type { StreamingFieldParser } from "../streaming/field-parser"
import type { TokenLogprob } from "../trace"

export interface Codec<TWireReq, TWireChunk> {
  readonly id: string
  readonly encodePrompt: (
    model: string,
    prompt: Prompt,
    tools: readonly ToolDefinition[],
  ) => Partial<TWireReq>
  readonly decode: <E, TStreamError>(
    chunks: Stream.Stream<TWireChunk, E>,
    options: {
      tools?: readonly ToolDefinition[]
      classifyStreamError: (failure: StreamFailure | E) => TStreamError
      generateToolCallId?: () => ToolCallId
    },
  ) => {
    readonly events: Stream.Stream<ResponseStreamEvent<TStreamError>, never>
    readonly parsers: ReadonlyMap<ToolCallId, StreamingFieldParser>
    readonly logprobs: TokenLogprob[]
  }
}
