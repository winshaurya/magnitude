import { Schema } from 'effect'

const NullableOptional = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.optionalWith(Schema.NullishOr(schema), {
    default: () => null as A | null,
  })

export const ProviderOptionsSchema = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
  project: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  rememberedModelIds: Schema.optional(Schema.Array(Schema.String)),
  discoveredModels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optional(Schema.String),
        maxContextTokens: NullableOptional(Schema.Number),
        discoveredAt: Schema.optional(Schema.String),
        source: Schema.optional(Schema.String),
      }),
    ),
  ),
  inventoryUpdatedAt: Schema.optional(Schema.String),
  lastDiscoveryError: Schema.optional(Schema.String),
  lastDiscoveryStatus: Schema.optional(
    Schema.Literal('success_non_empty', 'success_empty', 'failure'),
  ),
  lastDiscoverySource: Schema.optional(Schema.String),
  lastDiscoveryDiagnostics: Schema.optional(Schema.Array(Schema.String)),
}).pipe(Schema.extend(Schema.Record({ key: Schema.String, value: Schema.Unknown })))
export type ProviderOptions = Schema.Schema.Type<typeof ProviderOptionsSchema>

export const ContextLimitPolicySchema = Schema.Struct({
  softCapRatio: Schema.optional(Schema.Number),
  softCapMaxTokens: NullableOptional(Schema.Number),
})
export interface ContextLimitPolicy extends Omit<Schema.Schema.Type<typeof ContextLimitPolicySchema>, 'softCapMaxTokens'> {
  softCapMaxTokens: number | null
}

export const MagnitudeConfigSchema = Schema.Struct({
  contextLimits: Schema.optional(ContextLimitPolicySchema),
})

export type MagnitudeConfig = Schema.Schema.Type<typeof MagnitudeConfigSchema>
