/**
 * Error classification.
 *
 * Single source of truth for turning raw errors (HTTP responses, exceptions,
 * Effect causes) into the canonical TurnOutcome type.
 */

import { Cause } from 'effect'
import type { MagnitudeConnectionError, MagnitudeStreamError } from '@magnitudedev/magnitude-client'
import type { TurnOutcome } from '../events'
import type { TurnOutcome as HarnessTurnOutcome } from '@magnitudedev/harness'

/**
 * Map a typed connection error from magnitude-client into a TurnOutcome.
 */
export function mapConnectionErrorToOutcome(err: MagnitudeConnectionError): TurnOutcome {
  switch (err._tag) {
    case 'InsufficientCredits':
      return {
        _tag: 'ProviderNotReady',
        detail: {
          _tag: 'InsufficientCredits',
          message: err.message,
          balanceCents: err.details.balanceCents,
          requiredCents: err.details.requiredCents,
        },
      }
    case 'ModelNotAllowed':
    case 'ModelNotFound':
    case 'ModelNotMultimodal':
    case 'ModelNotGrammarCompatible':
    case 'RoleNotFound':
      return { _tag: 'ProviderNotReady', detail: { _tag: 'OutOfSync' } }
    case 'AuthFailed':
      return { _tag: 'ProviderNotReady', detail: { _tag: 'AuthFailed' } }
    case 'RateLimited':
      return {
        _tag: 'ConnectionFailure',
        detail: {
          _tag: 'TransportError',
          httpStatus: err.status,
          ...(err.retryAfterMs !== null ? { retryAfterMs: err.retryAfterMs } : {}),
        },
      }
    case 'UsageLimitExceeded':
      // Generic AI-layer transient 429-ish; retried as a connection failure.
      return { _tag: 'ConnectionFailure', detail: { _tag: 'ProviderError', httpStatus: err.status } }
    case 'ContextLimitExceeded':
      return { _tag: 'ContextWindowExceeded' }
    case 'InvalidRequest':
      return { _tag: 'ProviderNotReady', detail: { _tag: 'OutOfSync' } }
    case 'TransportError':
      return { _tag: 'ConnectionFailure', detail: { _tag: 'TransportError', httpStatus: err.status ?? undefined } }
  }
}

/**
 * Whether a MagnitudeConnectionError is retryable (transient).
 * Direct switch — no TurnOutcome involvement.
 */
export function isRetryableConnectionError(err: MagnitudeConnectionError): boolean {
  switch (err._tag) {
    case 'RateLimited':
    case 'TransportError':
    case 'UsageLimitExceeded':
      return true
    default:
      return false
  }
}

/**
 * Map a stream-time error into a HarnessTurnOutcome.
 */
export function mapStreamErrorToOutcome(err: MagnitudeStreamError): HarnessTurnOutcome {
  return { _tag: 'EngineDefect', message: `Stream error: ${err.message ?? 'unknown'}` }
}

const MAX_UNEXPECTED_MESSAGE_LEN = 500

function truncate(message: string): string {
  return message.length > MAX_UNEXPECTED_MESSAGE_LEN
    ? `${message.slice(0, MAX_UNEXPECTED_MESSAGE_LEN)}...`
    : message
}

/**
 * Classify an arbitrary unknown error (thrown exception, Effect cause, etc.)
 * into a TurnOutcome. Used for non-agent error sites — framework errors,
 * render boundaries, overlay fetch failures.
 *
 * Never returns a raw stack trace or Cause.pretty() output to the user;
 * those go to logs only via the caller.
 */
export function classifyUnknownError(err: unknown): TurnOutcome {
  if (err instanceof Error) {
    return {
      _tag: 'UnexpectedError',
      message: truncate(err.message || 'Unknown error'),
      detail: { _tag: 'Unknown' },
    }
  }
  if (typeof err === 'string') {
    return {
      _tag: 'UnexpectedError',
      message: truncate(err),
      detail: { _tag: 'Unknown' },
    }
  }
  if (Cause.isCause(err)) {
    const failure = Cause.failureOption(err)
    if (failure._tag === 'Some') return classifyUnknownError(failure.value)
    return {
      _tag: 'UnexpectedError',
      message: 'An unexpected error occurred.',
      detail: { _tag: 'Unknown' },
    }
  }
  return {
    _tag: 'UnexpectedError',
    message: 'An unexpected error occurred.',
    detail: { _tag: 'Unknown' },
  }
}
