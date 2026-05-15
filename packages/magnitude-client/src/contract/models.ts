/**
 * AUTO-GENERATED — do not edit manually.
 */

import type { RoleId } from "./roles"

export type EffortLevel = "low" | "medium" | "high" | "max"

export type ReasoningCapability =
  | { readonly type: "none" }
  | { readonly type: "always"; readonly effort: readonly EffortLevel[] }
  | { readonly type: "toggleable"; readonly default: "on" | "off"; readonly effort: readonly EffortLevel[]; readonly budget: boolean }

export interface ModelCapabilities {
  readonly vision: boolean
  readonly grammar: boolean
  readonly reasoning: ReasoningCapability
}

export interface MagnitudeModelInfo {
  readonly id: string
  readonly displayName: string
  readonly object: "model"
  readonly owned_by: string
  readonly roles: readonly RoleId[]
  readonly contextWindow: number
  readonly maxOutputTokens: number
  readonly capabilities: ModelCapabilities
}

export interface ModelListResponse {
  readonly object: "list"
  readonly data: readonly MagnitudeModelInfo[]
}

export type MagnitudeAdditionalOptions = {
  /** Override the default trait labels used in grammar-constrained reasoning. */
  traits?: string[]
}
