import type { UserPart } from '@magnitudedev/ai'
import type { CompletedTurn } from '../window/types'
import type { TimelineEntry } from './inbox/types'
import type { Skill } from '@magnitudedev/skills'
import type { ConfigState } from '../ambient/config-ambient'
import type { RoleId } from '../agents/role-validation'

import { estimateContentTokens, estimateText } from '../truncation/estimate'
import { estimateCompletedTurn } from '../util/turn-estimation'
import { renderTimeline } from './inbox/render'
import { getAgentDefinition } from '../agents/registry'
import { getEffectiveToolkit } from '../tools/toolkits'
import { renderToolDocs } from '../prompts/render-tool-docs'
import { buildSystemPrompt } from '../prompts/system-prompt-builder'

// =============================================================================
// Per-entry estimation
// =============================================================================

/** Estimate tokens for content-based entries (session_context, fork_context, compacted). */
export function estimateContentEntry(content: UserPart[]): number {
  return estimateContentTokens(content)
}

/** Estimate tokens for an assistant turn entry. */
export function estimateTurnEntry(turn: CompletedTurn): number {
  return estimateCompletedTurn(turn)
}

/** Estimate tokens for a context (timeline) entry by rendering it the same way windowToPrompt does. */
export function estimateContextEntry(timeline: readonly TimelineEntry[]): number {
  if (timeline.length === 0) return 0
  const rendered = renderTimeline({ timeline, timezone: null, agentStatus: { agents: new Map() } })
  return estimateContentTokens(rendered)
}

// =============================================================================
// System prompt estimation
// =============================================================================

const systemPromptTokenCache = new Map<string, number>()

/**
 * Estimate the token count of the full system prompt for a given role.
 * Cached per roleId — system prompts are stable across turns.
 */
export function estimateSystemPromptTokens(
  roleId: RoleId,
  skills: Map<string, Skill>,
  configState: ConfigState,
): number {
  const cached = systemPromptTokenCache.get(roleId)
  if (cached !== undefined) return cached

  const agentDef = getAgentDefinition(roleId)
  const toolkit = getEffectiveToolkit(roleId, configState)
  const toolDefs = toolkit.keys.map(key => toolkit.entries[key].tool.definition)
  const toolDocs = toolDefs.length > 0 ? renderToolDocs(toolDefs) : ''
  const prompt = buildSystemPrompt({ roleDef: agentDef, skills, lenses: [], toolDocs })

  const tokens = estimateText(prompt)
  systemPromptTokenCache.set(roleId, tokens)
  return tokens
}

// =============================================================================
// Budget math
// =============================================================================

/**
 * Compute total token estimate from anchor state + current messageTokens.
 *
 * If anchored: last API inputTokens measurement + delta since measurement.
 * If unanchored: systemPromptTokens + messageTokens (pure heuristic).
 */
export function computeTokenEstimate(
  systemPromptTokens: number,
  messageTokens: number,
  lastAnchoredTotal: number | null,
  lastAnchoredMessageTokens: number | null,
): number {
  if (lastAnchoredTotal !== null && lastAnchoredMessageTokens !== null) {
    return lastAnchoredTotal + (messageTokens - lastAnchoredMessageTokens)
  }
  return systemPromptTokens + messageTokens
}
