import { Context, Effect, Layer } from 'effect'
import type { BoundModel } from '@magnitudedev/ai'
import type { MagnitudeCallOptions, MagnitudeConnectionError, MagnitudeStreamError, ModelProfile, MagnitudeAdditionalOptions } from '@magnitudedev/magnitude-client'
import { MagnitudeClient } from '@magnitudedev/magnitude-client'
import { AmbientServiceTag, type AmbientService } from '@magnitudedev/event-core'
import type { RoleId } from '../agents/role-validation'
import { ConfigAmbient, getRoleConfig } from '../ambient/config-ambient'

export interface AgentBoundModel {
  readonly model: BoundModel<MagnitudeCallOptions, MagnitudeConnectionError, MagnitudeStreamError>
  readonly roleId: RoleId
  readonly modelId: string
  readonly profile: ModelProfile
}

const LEADER_TRAITS: MagnitudeAdditionalOptions = {
  traits: ['ATTENTIVE', 'STRATEGIC', 'PROACTIVE', 'RESPECTFUL', 'GROUNDED', 'INTROSPECTIVE', 'TASK'],
}

export interface AgentModelResolverService {
  readonly resolve: (roleId: RoleId) => Effect.Effect<AgentBoundModel, never, AmbientService>
}

export class AgentModelResolver extends Context.Tag('AgentModelResolver')<
  AgentModelResolver,
  AgentModelResolverService
>() {}

export const AgentModelResolverLive = () =>
  Layer.effect(
    AgentModelResolver,
    Effect.gen(function* () {
      const client = yield* MagnitudeClient

      return {
        resolve: (roleId: RoleId) =>
          Effect.gen(function* () {
            const ambientService = yield* AmbientServiceTag
            const configState = ambientService.getValue(ConfigAmbient)
            const roleConfig = getRoleConfig(configState, roleId)
            const defaults = {
              maxTokens: roleConfig.profile.maxOutputTokens,
              magnitudeAdditionalOptions: roleId === 'leader' ? LEADER_TRAITS : undefined,
            }
            const capabilities = { vision: roleConfig.profile.capabilities.vision }

            return {
              model: client.role(roleId, { defaults, capabilities }),
              roleId,
              modelId: `role/${roleId}`,
              profile: roleConfig.profile,
            }
          }),
      }
    }),
  )
