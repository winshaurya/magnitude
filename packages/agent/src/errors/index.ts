export {
  mapConnectionErrorToOutcome,
  mapStreamErrorToOutcome,
  classifyUnknownError,
  isRetryableConnectionError,
} from './classify'

export {
  present,
  presentConnectionError,
  type ErrorPresentation,
  type ErrorSurface,
  type ErrorSeverity,
  type ErrorCta,
  type ActionId,
} from './present'
