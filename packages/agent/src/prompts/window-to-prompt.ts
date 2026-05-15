/**
 * Window-to-prompt mapper.
 *
 * Converts WindowProjection state (WindowEntry[]) into an ai package Prompt
 * suitable for passing to the harness / BoundModel.
 *
 * Strategy:
 * - assistant_turn → AssistantMessage + ToolResultMessages + feedback UserMessage
 * - context → timeline rendered as UserMessage
 * - All other messages (session_context, fork_context, compacted) → UserMessages
 *
 * Formatting: takes a ToolResultFormatter function for rendering tool results.
 * The agent composes the default formatter with truncation override.
 */

import { Prompt, type Message as AiMessage, type TerminalMessages, type ToolResultPart } from '@magnitudedev/ai'
import type { WindowEntry, ForkWindowState } from '../window'
import type { UserPart } from '@magnitudedev/ai'
import type { TurnFeedback } from '../window/types'
import type { ToolResultEntry, ToolResult } from '@magnitudedev/harness'
import { isImageValue, type ToolResultFormatter } from '@magnitudedev/harness'
import { renderTimeline } from '../window/inbox/render'
import type { AgentStatusState } from '../projections/agent-status'
import { renderFeedbackText } from './feedback-text'
import { describeShape, estimateText } from '../truncation'
import { TRUNCATION_TOKEN_LIMIT } from '../constants'

// ---------------------------------------------------------------------------
// Truncation override for large Success outputs
// ---------------------------------------------------------------------------

export function formatTruncatedSuccess(
  entry: ToolResultEntry & { result: Extract<ToolResult, { _tag: 'Success' }> },
  turnId: string,
  estimatedTokens: number,
): readonly ToolResultPart[] {
  const resultPath = `$M/results/${turnId}_${entry.toolCallId}.json`
  const shapeSummary = describeShape(entry.result.output)
  const text = [
    `<truncated path="${resultPath}" estimated_tokens="${estimatedTokens}">`,
    shapeSummary,
    `</truncated>`,
  ].join('\n')
  return [{ _tag: 'TextPart', text }]
}

/**
 * Create a truncating formatter that overrides large Success outputs.
 * Delegates everything else to the default formatter.
 */
export function createTruncatingFormatter(
  defaultFormat: ToolResultFormatter,
  turnId: string,
): ToolResultFormatter {
  return (entry: ToolResultEntry): readonly ToolResultPart[] => {
    const result = entry.result
    if (result._tag === 'Success' && result.output !== undefined && !isImageValue(result.output)) {
      try {
        const serialized = JSON.stringify(result.output, null, 2)
        const estimatedTokens = estimateText(serialized)
        if (estimatedTokens > TRUNCATION_TOKEN_LIMIT) {
          return formatTruncatedSuccess(entry as ToolResultEntry & { result: Extract<ToolResult, { _tag: 'Success' }> }, turnId, estimatedTokens)
        }
      } catch {
        // fall through to default
      }
    }
    return defaultFormat(entry)
  }
}

/**
 * Wrap the harness formatter with agent-specific overrides.
 * Adds domain-specific <permission_rejected> formatting for denied tool calls.
 */
export function createAgentFormatter(
  harnessFormat: ToolResultFormatter,
): ToolResultFormatter {
  return (entry: ToolResultEntry): readonly ToolResultPart[] => {
    if (entry.result._tag === 'Denied') {
      const message = typeof entry.result.denial === 'string'
        ? entry.result.denial
        : String(entry.result.denial)
      return [{ _tag: 'TextPart', text:
        `<permission_rejected>\n` +
        `<reason>${message}</reason>\n` +
        `This restriction exists to prevent accidental or catastrophic operations. Do not try to work around it — respect the intent of the restriction rather than finding methods that bypass the check. Provide the command to the user if you need them to run it.\n` +
        `</permission_rejected>`
      }]
    }
    return harnessFormat(entry)
  }
}

// ---------------------------------------------------------------------------
// ToolResultEntry → ToolResultMessage conversion
// ---------------------------------------------------------------------------

function toolResultEntryToMessage(
  entry: ToolResultEntry,
  formatter: ToolResultFormatter,
  turnId: string,
): AiMessage {
  const parts = formatter(entry)

  return {
    _tag: 'ToolResultMessage',
    toolCallId: entry.toolCallId,
    providerToolCallId: entry.providerToolCallId,
    toolName: entry.toolName,
    parts,
  }
}

// ---------------------------------------------------------------------------
// TurnFeedback → UserMessage parts
// ---------------------------------------------------------------------------

function renderFeedback(feedback: readonly TurnFeedback[]): UserPart[] {
  const text = renderFeedbackText(feedback)
  if (!text) return []
  return [{ _tag: 'TextPart', text }]
}

// ---------------------------------------------------------------------------
// context → timeline UserMessage
// ---------------------------------------------------------------------------

function inboxToAiMessages(
  msg: Extract<WindowEntry, { type: 'context' }>,
  timezone: string | null,
  agentStatus: AgentStatusState,
): AiMessage[] {
  const inboxContent = renderTimeline({
    timeline: msg.timeline,
    timezone,
    agentStatus,
  })

  const hasContent = inboxContent.some(p => {
    if (p._tag === 'TextPart') return p.text.trim().length > 0
    if (p._tag === 'ImagePart') return true
    return false
  })

  if (!hasContent) return []

  return [{
    _tag: 'UserMessage',
    parts: inboxContent,
  }]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert window state into an ai Prompt.
 *
 * Preserves structured assistant turn information (reasoning, tool calls)
 * and converts semantic tool results into native ToolResultMessages for the model API.
 */
export function windowToPrompt(
  windowState: ForkWindowState,
  systemPrompt: string,
  timezone: string | null,
  agentStatus: AgentStatusState,
  formatter: ToolResultFormatter,
): Prompt {
  const messages: AiMessage[] = []

  for (const msg of windowState.messages) {
    switch (msg.type) {
      case 'session_context':
      case 'fork_context':
      case 'compacted': {
        messages.push({
          _tag: 'UserMessage',
          parts: msg.content,
        })
        break
      }

      case 'assistant_turn': {
        const { turn } = msg
        messages.push(turn.assistant)
        // Compose the formatter with truncation for this turn
        const turnFormatter = createTruncatingFormatter(formatter, turn.turnId)
        for (const entry of turn.toolResults) {
          messages.push(toolResultEntryToMessage(entry, turnFormatter, turn.turnId))
        }
        const feedbackParts = renderFeedback(turn.feedback)
        if (feedbackParts.length > 0) {
          messages.push({
            _tag: 'UserMessage',
            parts: feedbackParts,
          })
        }
        break
      }

      case 'context': {
        messages.push(...inboxToAiMessages(msg, timezone, agentStatus))
        break
      }
    }
  }

  // Ensure terminal message constraint: last message must be UserMessage or ToolResultMessage
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg._tag === 'AssistantMessage') {
    messages.push({
      _tag: 'UserMessage',
      parts: [{ _tag: 'TextPart', text: '(continue)' }],
    })
  }

  return Prompt.from({
    system: systemPrompt,
    messages: messages as unknown as TerminalMessages,
  })
}
