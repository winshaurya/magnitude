import type { Effect } from "effect"
import type * as HttpClient from "@effect/platform/HttpClient"
import { Prompt } from "../prompt/prompt"
import type { ToolCallId } from "../prompt/ids"
import type { ToolDefinition } from "../tools/tool-definition"
import type { ConnectionError, StreamError } from "../errors/model-error"
import type { ModelSpec, ModelStreamResult } from "./model-spec"

export interface BoundModel<
  TCallOptions,
  TConnectionError = ConnectionError,
  TStreamError = StreamError,
> {
  readonly spec: ModelSpec<TCallOptions, TConnectionError, TStreamError>

  readonly stream: (
    prompt: Prompt,
    tools: readonly ToolDefinition[],
    options?: TCallOptions & { generateToolCallId?: () => ToolCallId },
  ) => Effect.Effect<
    ModelStreamResult<TStreamError>,
    TConnectionError,
    HttpClient.HttpClient
  >
}
