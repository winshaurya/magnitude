/**
 * Retry/backoff constants and helpers for connection failures.
 *
 * Used by:
 *  - TurnProjection: computes `notBefore` timestamp on chain_continue triggers.
 *  - Cortex: enforces the cap by transforming the outcome before publishing.
 *  - RetryController: sleeps until the trigger's notBefore.
 *
 * All three must agree on the timing math, so it lives here.
 */

import type { TurnOutcome } from '../events'

export const MAX_RETRIES = 5
export const BASE_DELAY_MS = 500
export const MAX_DELAY_MS = 30_000

/**
 * Exponential backoff with cap. attempt is 0-indexed.
 * Sequence: 500ms, 1s, 2s, 4s, 8s (capped at 30s for higher attempts).
 *
 * If a server-provided hint is present (Retry-After header), use the larger of
 * the two so we never retry sooner than the server told us.
 */
export function computeDelayMs(attempt: number, hintMs: number | undefined): number {
  const computed = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
  return hintMs !== undefined ? Math.max(hintMs, computed) : computed
}

/**
 * Extract the server's Retry-After hint from a ConnectionFailure outcome,
 * if any. Currently only TransportError and ProviderError carry this.
 */
export function getRetryAfterHint(outcome: TurnOutcome): number | undefined {
  if (outcome._tag !== 'ConnectionFailure') return undefined
  const detail = outcome.detail
  if (detail._tag === 'TransportError') return detail.retryAfterMs
  if (detail._tag === 'ProviderError') return detail.retryAfterMs
  return undefined
}

export const TERMINAL_RETRY_EXHAUSTED_MESSAGE =
  'Lost connection to Magnitude. Check your network and try again.'
