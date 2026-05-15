import {
  NativeChatCompletions,
  defaultClassifyStreamError,
  type ModelSpec,
  type StreamError,
  type ModelCapabilities as AIModelCapabilities,
  Option,
} from "@magnitudedev/ai"
import { classifyMagnitudeConnectionError, type MagnitudeConnectionError } from "./errors"
import type { RoleId, ModelCapabilities, MagnitudeModelInfo, MagnitudeAdditionalOptions } from './contract'

/**
 * Model metadata needed by the agent runtime — a strict subset of MagnitudeModelInfo.
 * Covers context limits, output defaults, and capability flags.
 */
export interface ModelProfile {
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly capabilities: ModelCapabilities
}

/**
 * Extract a ModelProfile from a MagnitudeModelInfo catalog entry.
 */
export function toModelProfile(info: MagnitudeModelInfo): ModelProfile {
  return {
    contextWindow: info.contextWindow,
    maxOutputTokens: info.maxOutputTokens,
    capabilities: info.capabilities,
  }
}

/** Symmetric with MagnitudeConnectionError; extend when Magnitude-specific stream errors are needed. */
export type MagnitudeStreamError = StreamError

/** All models consumed by the agent must conform to this type. */
export type MagnitudeModelSpec = ModelSpec<MagnitudeCallOptions, MagnitudeConnectionError, MagnitudeStreamError>

export interface MagnitudeCompatibleSpecConfig {
  modelId: string
  endpoint: string
}

/** Call options supported by Magnitude model specs. */
export type MagnitudeCallOptions = {
  maxTokens?: number
  magnitudeAdditionalOptions?: MagnitudeAdditionalOptions
}

const magnitudeOptions = {
  maxTokens: NativeChatCompletions.options.maxTokens,
  magnitudeAdditionalOptions: Option.define(
    (v: MagnitudeAdditionalOptions) => ({ magnitude_additional_options: v }),
  ),
} as const

export function createMagnitudeCompatibleSpec(config: MagnitudeCompatibleSpecConfig) {
  return NativeChatCompletions.model({
    modelId: config.modelId,
    endpoint: config.endpoint,
    options: magnitudeOptions,
    classifyConnectionError: (failure) =>
      classifyMagnitudeConnectionError(failure),
    classifyStreamError: (failure) =>
      defaultClassifyStreamError(failure),
  })
}

export function createRoleSpec(roleId: RoleId, endpoint: string, capabilities?: AIModelCapabilities) {
  return NativeChatCompletions.model({
    modelId: `role/${roleId}`,
    endpoint,
    options: magnitudeOptions,
    classifyConnectionError: (failure) =>
      classifyMagnitudeConnectionError(failure),
    classifyStreamError: (failure) =>
      defaultClassifyStreamError(failure),
    capabilities,
  })
}
