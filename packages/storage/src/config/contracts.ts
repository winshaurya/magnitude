import { Context, Effect } from 'effect'

import type { ResolvedContextLimitPolicy } from './defaults'
import type { ContextLimitPolicy, MagnitudeConfig } from '../types'

export interface ConfigStorageShape<TSlot extends string> {
  readonly load: () => Effect.Effect<MagnitudeConfig>
  readonly save: (config: MagnitudeConfig) => Effect.Effect<void>
  readonly update: (
    f: (config: MagnitudeConfig) => MagnitudeConfig
  ) => Effect.Effect<MagnitudeConfig>

  readonly getContextLimitPolicy: () => Effect.Effect<ResolvedContextLimitPolicy>
  readonly setContextLimitPolicy: (
    policy: ContextLimitPolicy
  ) => Effect.Effect<void>

}

export const ConfigStorage = Context.GenericTag<ConfigStorageShape<string>>('ConfigStorage')
export type ConfigStorage = Context.Tag.Identifier<typeof ConfigStorage>

export {
  ConfigStorage as AppConfig,
}
export type AppConfigShape<TSlot extends string> = ConfigStorageShape<TSlot>
