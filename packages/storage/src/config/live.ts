import { Effect, Layer } from 'effect'

import { resolveContextLimitPolicy } from './defaults'
import { ConfigStorage, type ConfigStorageShape } from './contracts'
import { loadConfig, saveConfig, updateConfig } from './storage'
import { GlobalStorage, type GlobalStorageShape } from '../services'
import type { ContextLimitPolicy, MagnitudeConfig } from '../types'

const makeConfigStorageShape = <TSlot extends string>(
  globalStorage: GlobalStorageShape
): ConfigStorageShape<TSlot> => ({
  load: () => Effect.promise(() => loadConfig(globalStorage.paths)),
  save: (config: MagnitudeConfig) =>
    Effect.promise(() => saveConfig(globalStorage.paths, config)),
  update: (f: (config: MagnitudeConfig) => MagnitudeConfig) =>
    Effect.promise(() => updateConfig(globalStorage.paths, f)),

  getContextLimitPolicy: () =>
    Effect.promise(async () =>
      resolveContextLimitPolicy(await loadConfig(globalStorage.paths))
    ),

  setContextLimitPolicy: (policy: ContextLimitPolicy) =>
    Effect.promise(async () => {
      await updateConfig(globalStorage.paths, (config) => ({
        ...config,
        contextLimits: {
          ...(config.contextLimits ?? {}),
          ...policy,
        },
      }))
    }),

})

export const ConfigStorageLive = Layer.effect(
  ConfigStorage,
  Effect.gen(function* () {
    const globalStorage = yield* GlobalStorage
    return ConfigStorage.of(
      makeConfigStorageShape<string>(globalStorage) as ConfigStorageShape<string>
    )
  })
)
