import type { Effect, Stream } from "effect"
import type * as HttpClient from "@effect/platform/HttpClient"
import { Prompt } from "../prompt/prompt"
import type { BoundModel } from "./bound-model"
import type { ModelCapabilities } from "./capabilities"
import type { ToolCallId } from "../prompt/ids"
import type { ToolDefinition } from "../tools/tool-definition"
import type { ResponseStreamEvent } from "../response/events"
import type { AuthApplicator } from "../auth/auth"
import type { ImagePlaceholderConfig } from "./capabilities"
import type { StreamingFieldParser } from "../streaming/field-parser"
import type { ConnectionError, StreamError } from "../errors/model-error"
import type { TokenLogprob } from "../trace"

export type ModelStreamResult<TStreamError> = {
  readonly events: Stream.Stream<ResponseStreamEvent<TStreamError>, never>
  readonly parsers: ReadonlyMap<ToolCallId, StreamingFieldParser>
  readonly logprobs: TokenLogprob[]
}

export interface ModelSpec<
  TCallOptions,
  TConnectionError = ConnectionError,
  TStreamError = StreamError,
> {
  readonly modelId: string
  readonly endpoint: string
  readonly capabilities?: ModelCapabilities

  /** Bind this spec with auth and optional default options to create a BoundModel. */
  readonly bind: (args: {
    auth: AuthApplicator,
    defaults?: Partial<TCallOptions>,
    imagePlaceholders?: ImagePlaceholderConfig,
  }) => BoundModel<TCallOptions, TConnectionError, TStreamError>

  /** @internal — closed over codec, options, transport config, classifiers */
  readonly _execute: (
    auth: AuthApplicator,
    prompt: Prompt,
    tools: readonly ToolDefinition[],
    options: TCallOptions,
  ) => Effect.Effect<
    ModelStreamResult<TStreamError>,
    TConnectionError,
    HttpClient.HttpClient
  >
}
