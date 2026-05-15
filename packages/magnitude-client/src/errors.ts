import { Data } from "effect"
import type { MagnitudeApiError, InsufficientCreditsDetails } from "./contract"
import {
  defaultClassifyConnectionError,
  TransportError,
  type ConnectionError,
  type HttpConnectionFailure,
} from "@magnitudedev/ai"

// --- Magnitude-specific errors ---

export class InsufficientCredits extends Data.TaggedError("InsufficientCredits")<{
  readonly message: string
  readonly details: InsufficientCreditsDetails
}> {}

export class ModelNotAllowed extends Data.TaggedError("ModelNotAllowed")<{
  readonly message: string
}> {}

export class ModelNotFound extends Data.TaggedError("ModelNotFound")<{
  readonly message: string
}> {}

export class ModelNotMultimodal extends Data.TaggedError("ModelNotMultimodal")<{
  readonly message: string
}> {}

export class ModelNotGrammarCompatible extends Data.TaggedError("ModelNotGrammarCompatible")<{
  readonly message: string
}> {}

export class RoleNotFound extends Data.TaggedError("RoleNotFound")<{
  readonly message: string
}> {}

export type MagnitudeConnectionError =
  | ConnectionError
  | InsufficientCredits
  | ModelNotAllowed
  | ModelNotFound
  | ModelNotMultimodal
  | ModelNotGrammarCompatible
  | RoleNotFound

// --- Body parser ---

export function tryParseErrorBody(body: string): MagnitudeApiError | null {
  try {
    const parsed = JSON.parse(body)
    if (parsed?.error?.type && parsed?.error?.code) return parsed as MagnitudeApiError
    return null
  } catch {
    return null
  }
}

// --- Classifier ---

export function classifyMagnitudeConnectionError(
  failure: HttpConnectionFailure,
): MagnitudeConnectionError {
  const parsed = tryParseErrorBody(failure.body)

  if (parsed) {
    switch (parsed.error.code) {
      case "insufficient_credits":
        return new InsufficientCredits({
          message: parsed.error.message,
          details: parsed.error.details as InsufficientCreditsDetails,
        })
      case "model_not_allowed":
        return new ModelNotAllowed({ message: parsed.error.message })
      case "model_not_found":
        return new ModelNotFound({ message: parsed.error.message })
      case "model_not_multimodal":
        return new ModelNotMultimodal({ message: parsed.error.message })
      case "model_not_grammar_compatible":
        return new ModelNotGrammarCompatible({ message: parsed.error.message })
      case "role_not_found":
        return new RoleNotFound({ message: parsed.error.message })
      case "upstream_unavailable":
        return new TransportError({
          status: failure.status,
          message: parsed.error.message,
          retryable: true,
        })
      case "stream_interrupted":
        return new TransportError({
          status: failure.status,
          message: parsed.error.message,
          retryable: true,
        })
      case "internal_server_error":
        return new TransportError({
          status: failure.status,
          message: parsed.error.message,
          retryable: true,
        })
      case "provider_error":
        return new TransportError({
          status: failure.status,
          message: parsed.error.message,
          retryable: true,
        })
    }
  }

  return defaultClassifyConnectionError(failure)
}
