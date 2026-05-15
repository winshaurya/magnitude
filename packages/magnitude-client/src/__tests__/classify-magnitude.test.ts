import { describe, it, expect } from "vitest"
import {
  classifyMagnitudeConnectionError,
  InsufficientCredits,
  ModelNotAllowed,
  ModelNotFound,
  ModelNotMultimodal,
  ModelNotGrammarCompatible,
  RoleNotFound,
} from "../errors"
import { TransportError } from "@magnitudedev/ai"
import type { HttpConnectionFailure } from "@magnitudedev/ai"

function makeFailure(status: number, body: string): HttpConnectionFailure {
  return { status, headers: new Headers(), body }
}

function makeMagnitudeBody(
  code: string,
  type: string,
  message: string,
): string {
  return JSON.stringify({
    error: { message, type, code, param: null },
  })
}

describe("classifyMagnitudeConnectionError", () => {
  describe("structured JSON body — new retryable transport errors", () => {
    it("classifies upstream_unavailable as retryable TransportError", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(503, makeMagnitudeBody("upstream_unavailable", "service_unavailable", "upstream provider is unavailable")),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") {
        expect(result.retryable).toBe(true)
        expect(result.message).toBe("upstream provider is unavailable")
      }
    })

    it("classifies stream_interrupted as retryable TransportError", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(500, makeMagnitudeBody("stream_interrupted", "server_error", "stream was interrupted mid-response")),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") {
        expect(result.retryable).toBe(true)
        expect(result.message).toBe("stream was interrupted mid-response")
      }
    })

    it("classifies internal_server_error as retryable TransportError", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(500, makeMagnitudeBody("internal_server_error", "server_error", "internal server error")),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") {
        expect(result.retryable).toBe(true)
      }
    })

    it("classifies provider_error as retryable TransportError", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(502, makeMagnitudeBody("provider_error", "server_error", "provider returned an unexpected response")),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") {
        expect(result.retryable).toBe(true)
      }
    })
  })

  describe("structured JSON body — existing Magnitude errors", () => {
    it("classifies insufficient_credits as InsufficientCredits", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(402, makeMagnitudeBody("insufficient_credits", "insufficient_quota", "not enough credits")),
      )
      expect(result._tag).toBe("InsufficientCredits")
      if (result._tag === "InsufficientCredits") {
        expect(result.message).toBe("not enough credits")
      }
    })

    it("classifies model_not_allowed as ModelNotAllowed", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(403, makeMagnitudeBody("model_not_allowed", "authentication_error", "model not allowed for this key")),
      )
      expect(result._tag).toBe("ModelNotAllowed")
      if (result._tag === "ModelNotAllowed") {
        expect(result.message).toBe("model not allowed for this key")
      }
    })

    it("classifies model_not_found as ModelNotFound", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(404, makeMagnitudeBody("model_not_found", "invalid_request_error", "model does not exist")),
      )
      expect(result._tag).toBe("ModelNotFound")
      if (result._tag === "ModelNotFound") {
        expect(result.message).toBe("model does not exist")
      }
    })

    it("classifies model_not_multimodal as ModelNotMultimodal", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(400, makeMagnitudeBody("model_not_multimodal", "invalid_request_error", "model does not support images")),
      )
      expect(result._tag).toBe("ModelNotMultimodal")
      if (result._tag === "ModelNotMultimodal") {
        expect(result.message).toBe("model does not support images")
      }
    })

    it("classifies model_not_grammar_compatible as ModelNotGrammarCompatible", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(400, makeMagnitudeBody("model_not_grammar_compatible", "invalid_request_error", "model does not support grammar")),
      )
      expect(result._tag).toBe("ModelNotGrammarCompatible")
      if (result._tag === "ModelNotGrammarCompatible") {
        expect(result.message).toBe("model does not support grammar")
      }
    })

    it("classifies role_not_found as RoleNotFound", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(404, makeMagnitudeBody("role_not_found", "invalid_request_error", "role not found")),
      )
      expect(result._tag).toBe("RoleNotFound")
      if (result._tag === "RoleNotFound") {
        expect(result.message).toBe("role not found")
      }
    })
  })

  describe("fallthrough to defaultClassifyConnectionError", () => {
    it("unrecognized Magnitude code falls through", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(400, makeMagnitudeBody("some_unknown_code", "invalid_request_error", "unknown error")),
      )
      // Not a Magnitude-specific error type, falls to generic classification
      expect(result._tag).toBe("InvalidRequest")
    })

    it("non-JSON body falls through to defaultClassifyConnectionError", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(500, "Internal Server Error"),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") {
        expect(result.retryable).toBe(true)
      }
    })

    it("empty JSON without error.code falls through", () => {
      const result = classifyMagnitudeConnectionError(
        makeFailure(400, JSON.stringify({ error: { message: "oops", type: "invalid_request_error" } })),
      )
      expect(result._tag).toBe("InvalidRequest")
    })
  })
})
