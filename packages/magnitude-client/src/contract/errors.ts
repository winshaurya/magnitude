/**
 * AUTO-GENERATED — do not edit manually.
 */

export interface MagnitudeApiError {
  readonly error: {
    readonly message: string
    readonly type: MagnitudeErrorType
    readonly code: MagnitudeErrorCode
    readonly param: string | null
    readonly details?: MagnitudeErrorDetails
  }
}

export type MagnitudeErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "insufficient_quota"
  | "rate_limit_error"
  | "server_error"
  | "service_unavailable"

export type MagnitudeErrorCode =
  | "invalid_api_key"
  | "invalid_body"
  | "unsupported_field"
  | "unsupported_n"
  | "invalid_image_url"
  | "invalid_multimodal_role"
  | "model_not_allowed"
  | "model_not_found"
  | "model_not_multimodal"
  | "model_not_grammar_compatible"
  | "insufficient_credits"
  | "provider_rate_limited"
  | "internal_server_error"
  | "provider_error"
  | "upstream_unavailable"
  | "stream_interrupted"
  | "role_not_found"
  | "utility_not_found"

export type MagnitudeErrorDetails = InsufficientCreditsDetails

export interface InsufficientCreditsDetails {
  readonly category: "insufficient_credits"
  readonly balanceCents: number
  readonly requiredCents: number
}
