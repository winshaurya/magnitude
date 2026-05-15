import { Ambient, AmbientServiceTag } from '@magnitudedev/event-core'
import { Effect } from 'effect'
import { FetchHttpClient } from '@effect/platform'

import {
  MagnitudeClient,
  toModelProfile,
  type ModelProfile,
  type MagnitudeModelInfo,
} from '@magnitudedev/magnitude-client'
import {
  computeContextLimits,
  DEFAULT_CONTEXT_LIMIT_POLICY,
  type ResolvedContextLimitPolicy,
  type StorageClient,
} from '@magnitudedev/storage'

import { ROLE_IDS, type RoleId } from '../agents/role-validation'
import { OUTPUT_TOKEN_RESERVE } from '../constants'

export interface RoleConfig {
  readonly modelId: string
  readonly profile: ModelProfile
  readonly hardCap: number
  readonly softCap: number
}

export interface ConfigState {
  readonly byRole: Readonly<Record<RoleId, RoleConfig>>
  readonly catalogLoaded: boolean
}

const FALLBACK_PROFILE: ModelProfile = {
  contextWindow: 200_000,
  maxOutputTokens: 16_384,
  capabilities: { vision: true, grammar: false, reasoning: { type: 'none' } },
}

export function getRoleConfig(state: ConfigState, roleId: RoleId): RoleConfig {
  return state.byRole[roleId]
}

export function buildConfigState(
  catalogModels: readonly MagnitudeModelInfo[] | null,
  policy: ResolvedContextLimitPolicy,
): ConfigState {
  const byRole = {} as Record<RoleId, RoleConfig>
  for (const roleId of ROLE_IDS) {
    const catalogEntry = catalogModels?.find(m => m.roles.includes(roleId))
    const profile = catalogEntry ? toModelProfile(catalogEntry) : FALLBACK_PROFILE
    const modelId = `role/${roleId}`
    const hardCap = profile.contextWindow - OUTPUT_TOKEN_RESERVE
    const { softCap } = computeContextLimits(hardCap, policy)
    byRole[roleId] = { modelId, profile, hardCap, softCap }
  }
  return { byRole, catalogLoaded: catalogModels !== null }
}

export const ConfigAmbient = Ambient.define<ConfigState, never>({
  name: 'Config',
  initial: Effect.succeed(
    buildConfigState(null, DEFAULT_CONTEXT_LIMIT_POLICY),
  ),
})

export function publishConfigFromCatalog(storage: StorageClient) {
  return Effect.gen(function* () {
    const client = yield* MagnitudeClient
    const ambientService = yield* AmbientServiceTag

    const models = yield* client.catalog.list.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.catchAll((err) =>
        Effect.logWarning(`Failed to fetch model catalog: ${err}`)
          .pipe(Effect.as(null))
      ),
    )

    const policy = yield* Effect.promise(() => storage.config.getContextLimitPolicy())
    const newState = buildConfigState(models, policy)
    console.log('[CONFIG-AMBIENT] publishConfigFromCatalog:', JSON.stringify({ policy, leaderSoftCap: newState.byRole.leader?.softCap }))
    yield* ambientService.update(
      ConfigAmbient,
      newState,
    )
  })
}
