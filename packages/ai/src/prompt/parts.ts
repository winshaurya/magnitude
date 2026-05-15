import { Schema } from "effect"
import type { ProviderToolCallId, ToolCallId } from "./ids"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({
      key: Schema.String,
      value: JsonValueSchema,
    }),
  ),
)

export interface TextPart {
  readonly _tag: "TextPart"
  readonly text: string
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImagePart {
  readonly _tag: "ImagePart"
  readonly data: string
  readonly mediaType: ImageMediaType
  readonly dimensions?: { readonly width: number; readonly height: number }
}

export interface ToolCallPart {
  readonly _tag: "ToolCallPart"
  readonly id: ToolCallId
  readonly providerToolCallId: ProviderToolCallId
  readonly name: string
  readonly input: JsonValue
}

export const TextPartSchema = Schema.TaggedStruct("TextPart", {
  text: Schema.String,
})

export const ImagePartSchema = Schema.TaggedStruct("ImagePart", {
  data: Schema.String,
  mediaType: Schema.Literal('image/png', 'image/jpeg', 'image/webp', 'image/gif'),
})

export const ToolCallPartSchema = Schema.TaggedStruct("ToolCallPart", {
  id: Schema.String,
  providerToolCallId: Schema.String,
  name: Schema.String,
  input: JsonValueSchema,
})

export type PromptPart = TextPart | ImagePart | ToolCallPart
