import { Effect } from 'effect'
import { FetchHttpClient } from '@effect/platform'
import { createMagnitudeClient, isEnvFlagOn, type ModelListResponse } from '@magnitudedev/magnitude-client'
import { isRoleId, type RoleId } from './agents/role-validation'

export interface RoleProfile {
  readonly contextWindow: number
  readonly modelId: string
  readonly modelDisplayName: string
}

export async function fetchRoleProfiles(
  apiKey?: string,
  endpoint?: string,
): Promise<Partial<Record<RoleId, RoleProfile>>> {
  const client = createMagnitudeClient({ apiKey, endpoint })
  const models = await Effect.runPromise(
    client.catalog.list.pipe(Effect.provide(FetchHttpClient.layer)),
  )
  const out: Partial<Record<RoleId, RoleProfile>> = {}
  for (const m of models) {
    for (const r of m.roles) {
      if (isRoleId(r)) {
        out[r] = {
          contextWindow: m.contextWindow,
          modelId: m.id,
          modelDisplayName: m.displayName,
        }
      }
    }
  }
  return out
}

export async function fetchPublicRoleProfiles(
  endpoint?: string,
): Promise<Partial<Record<RoleId, RoleProfile>> | null> {
  try {
    const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)
    const baseUrl =
      endpoint ?? (useLocal
        ? 'http://localhost:3000/api/v1'
        : 'https://app.magnitude.dev/api/v1')

    const res = await fetch(`${baseUrl}/public/models`)
    if (!res.ok) return null

    const body = await res.json() as ModelListResponse
    const out: Partial<Record<RoleId, RoleProfile>> = {}
    for (const m of body.data) {
      for (const r of m.roles) {
        if (isRoleId(r)) {
          out[r] = {
            contextWindow: m.contextWindow,
            modelId: m.id,
            modelDisplayName: m.displayName,
          }
        }
      }
    }
    return out
  } catch {
    return null
  }
}
