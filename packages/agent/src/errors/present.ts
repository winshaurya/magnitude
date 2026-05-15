/**
 * Error presentation.
 *
 * Single source of truth for what every TurnOutcome looks like to the user
 * (and what it looks like fed back to the model). All copy lives here.
 */

import type {
  TurnOutcome,
  ProviderNotReadyDetail,
  ConnectionFailureDetail,
  SafetyStopReason,
} from '../events'
import type { MagnitudeConnectionError } from '@magnitudedev/magnitude-client'

export type ErrorSurface = 'inline' | 'toast' | 'silent'
export type ErrorSeverity = 'error' | 'warning' | 'info'

/** Action IDs the CLI knows how to dispatch when the user invokes an action CTA. */
export type ActionId = 'open-settings' | 'open-usage'

export type ErrorCta =
  | { readonly kind: 'url'; readonly label: string; readonly url: string }
  | { readonly kind: 'action'; readonly label: string; readonly actionId: ActionId; readonly chord: string }

export interface ErrorPresentation {
  /** Where this should appear, if anywhere. */
  readonly surface: ErrorSurface
  readonly severity: ErrorSeverity
  /** User-facing copy. Empty when surface is 'silent'. */
  readonly message: string
  /** Optional CTA shown beneath the message. */
  readonly cta?: ErrorCta
  /** Text to feed back to the model as observation. Omit for none. */
  readonly llmFeedback?: string
  /** Whether the underlying condition is auto-retried by the agent loop. */
  readonly retryable: boolean
}

const TOP_UP_CTA: ErrorCta = { kind: 'url', label: 'Top up credits', url: 'https://app.magnitude.dev/billing' }
const UPDATE_MAGNITUDE_CTA: ErrorCta = { kind: 'url', label: 'Update Magnitude', url: 'https://docs.magnitude.dev/get-started' }
const OPEN_SETTINGS_CTA: ErrorCta = { kind: 'action', label: 'Open settings', actionId: 'open-settings', chord: 'ctrl+s' }
const VIEW_USAGE_CTA: ErrorCta = { kind: 'action', label: 'View usage', actionId: 'open-usage', chord: 'ctrl+u' }

const SILENT: ErrorPresentation = {
  surface: 'silent',
  severity: 'info',
  message: '',
  retryable: false,
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function insufficientCreditsMessage(balanceCents: number, requiredCents: number): string {
  return `Insufficient credits. Balance: ${formatDollars(balanceCents)}. This request needs: ${formatDollars(requiredCents)}.`
}

function presentProviderNotReady(detail: ProviderNotReadyDetail): ErrorPresentation {
  switch (detail._tag) {
    case 'AuthFailed':
      return {
        surface: 'inline',
        severity: 'error',
        message: 'Authentication failed. API key may be invalid or revoked.',
        cta: OPEN_SETTINGS_CTA,
        llmFeedback: 'Authentication failed. API key may be invalid or revoked.',
        retryable: false,
      }
    case 'OutOfSync':
      return {
        surface: 'inline',
        severity: 'error',
        message: 'Magnitude is out of sync with the server. Try updating to the latest version.',
        cta: UPDATE_MAGNITUDE_CTA,
        llmFeedback: 'Out-of-sync error from server. The CLI may need to be updated.',
        retryable: false,
      }
    case 'InsufficientCredits': {
      const message = insufficientCreditsMessage(detail.balanceCents, detail.requiredCents)
      return {
        surface: 'inline',
        severity: 'error',
        message,
        cta: TOP_UP_CTA,
        llmFeedback: message,
        retryable: false,
      }
    }
  }
}

function presentConnectionFailure(detail: ConnectionFailureDetail): ErrorPresentation {
  // Connection failures are auto-retried by the loop. We render a dim status
  // indicator inside the think block (driven separately in display.ts) and
  // feed a short note back to the model. We do NOT render an inline error
  // for each retry — that's noise.
  let llmFeedback: string
  switch (detail._tag) {
    case 'ProviderError':
      llmFeedback = `Connection issue with provider (HTTP ${detail.httpStatus}); retrying.`
      break
    case 'TransportError':
      llmFeedback = detail.httpStatus !== undefined
        ? `Transport connection issue (HTTP ${detail.httpStatus}); retrying.`
        : 'Transport connection issue; retrying.'
      break
    case 'StreamError':
      llmFeedback = 'Response stream interrupted; retrying.'
      break
  }
  return {
    surface: 'silent',
    severity: 'warning',
    message: '',
    llmFeedback,
    retryable: true,
  }
}

function presentSafetyStop(reason: SafetyStopReason): ErrorPresentation {
  let userMessage: string
  let feedback: string
  switch (reason._tag) {
    case 'IdenticalResponseCircuitBreaker':
      userMessage = `Stopped after ${reason.threshold} identical responses`
      feedback = `Safety stop: repeated identical responses reached threshold ${reason.threshold}.`
      break
    case 'Other':
      userMessage = reason.message
      feedback = `Safety stop: ${reason.message}`
      break
  }
  return {
    surface: 'inline',
    severity: 'error',
    message: userMessage,
    llmFeedback: feedback,
    retryable: false,
  }
}

/**
 * Present a MagnitudeConnectionError for user display.
 * Used by compaction (which doesn't go through TurnOutcome).
 */
export function presentConnectionError(err: MagnitudeConnectionError): ErrorPresentation {
  switch (err._tag) {
    case 'InsufficientCredits': {
      const message = insufficientCreditsMessage(err.details.balanceCents, err.details.requiredCents)
      return {
        surface: 'inline',
        severity: 'error',
        message,
        cta: TOP_UP_CTA,
        llmFeedback: message,
        retryable: false,
      }
    }
    case 'AuthFailed':
      return {
        surface: 'inline',
        severity: 'error',
        message: 'Authentication failed. Run /settings to update your API key.',
        cta: OPEN_SETTINGS_CTA,
        llmFeedback: 'Authentication failed. API key may be invalid or revoked.',
        retryable: false,
      }
    case 'RateLimited':
      return {
        surface: 'silent',
        severity: 'warning',
        message: '',
        llmFeedback: `Rate limited by provider (HTTP ${err.status}); retrying.`,
        retryable: true,
      }
    case 'TransportError':
      return {
        surface: 'silent',
        severity: 'warning',
        message: '',
        llmFeedback: err.status != null
          ? `Transport connection issue (HTTP ${err.status}); retrying.`
          : 'Transport connection issue; retrying.',
        retryable: true,
      }
    case 'UsageLimitExceeded':
      return {
        surface: 'silent',
        severity: 'warning',
        message: '',
        llmFeedback: `Connection issue with provider (HTTP ${err.status}); retrying.`,
        retryable: true,
      }
    case 'ContextLimitExceeded':
      return {
        surface: 'silent',
        severity: 'warning',
        message: '',
        llmFeedback: 'Context window exceeded; waiting for compaction or context reduction.',
        retryable: false,
      }
    case 'InvalidRequest':
    case 'ModelNotAllowed':
    case 'ModelNotFound':
    case 'ModelNotMultimodal':
    case 'ModelNotGrammarCompatible':
    case 'RoleNotFound':
      return {
        surface: 'inline',
        severity: 'error',
        message: err.message,
        cta: VIEW_USAGE_CTA,
        llmFeedback: err.message,
        retryable: false,
      }
  }
}

/**
 * Map a TurnOutcome to its presentation.
 *
 * Pure function. Every variant has a single defined behavior here — change
 * copy or routing in one place and every surface picks it up.
 */
export function present(outcome: TurnOutcome): ErrorPresentation {
  switch (outcome._tag) {
    case 'Completed':
      return SILENT
    case 'Cancelled':
      return { ...SILENT, llmFeedback: 'interrupted' }
    case 'ParseFailure':
      return SILENT
    case 'ContextWindowExceeded':
      return {
        surface: 'silent',
        severity: 'warning',
        message: '',
        llmFeedback: 'Context window exceeded; waiting for compaction or context reduction.',
        retryable: false,
      }
    case 'OutputTruncated':
      return {
        surface: 'inline',
        severity: 'error',
        message: 'Response exceeded output limit',
        llmFeedback: 'Output was truncated. Respond in smaller, more bounded steps.',
        retryable: false,
      }
    case 'SafetyStop':
      return presentSafetyStop(outcome.reason)
    case 'ProviderNotReady':
      return presentProviderNotReady(outcome.detail)
    case 'ConnectionFailure':
      return presentConnectionFailure(outcome.detail)
    case 'UnexpectedError':
      return {
        surface: 'inline',
        severity: 'error',
        message: outcome.message,
        llmFeedback: outcome.message,
        retryable: false,
      }
    case 'ToolInputValidationFailure':
      return SILENT
    case 'ToolExecutionError':
      return SILENT
    case 'GateRejected':
      return SILENT
  }
}
