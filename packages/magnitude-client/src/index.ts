export * from "./contract"
export { createModelCatalog, type ModelCatalog, type ModelCatalogConfig } from "./catalog"
export {
  InsufficientCredits,
  ModelNotAllowed,
  ModelNotFound,
  ModelNotMultimodal,
  ModelNotGrammarCompatible,
  RoleNotFound,
  tryParseErrorBody,
  classifyMagnitudeConnectionError,
  type MagnitudeConnectionError,
} from "./errors"
export { createRoleSpec, createMagnitudeCompatibleSpec, toModelProfile, type MagnitudeCallOptions, type MagnitudeModelSpec, type MagnitudeStreamError, type MagnitudeCompatibleSpecConfig, type ModelProfile } from "./models"
export { createMagnitudeClient, MagnitudeClient, WebSearchError, type MagnitudeClientConfig, type MagnitudeClientShape, type WebSearchResult, type BalanceQuery } from "./client"
export { isEnvFlagOn } from "./env"
