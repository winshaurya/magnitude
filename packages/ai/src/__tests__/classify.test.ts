import { describe, it, expect } from "vitest"
import { defaultClassifyConnectionError } from "../errors/classify"
import type { HttpConnectionFailure } from "../errors/failure"

const VERCEL_HTML_500 = `<!DOCTYPE html><html data-dpl-id="dpl_test" id="__next_error__"><head><title>500: This page couldn't load</title></head><body><script>self.__next_f.push([1,"0:{\\"P\\":null,\\"forbidden\\":\\"$undefined\\",\\"unauthorized\\":\\"$undefined\\"}"])</script></body></html>`

function makeFailure(args: { status: number; body: string; contentType?: string }): HttpConnectionFailure {
  const headers = new Headers()
  if (args.contentType) headers.set("content-type", args.contentType)
  return { status: args.status, headers, body: args.body }
}

describe("defaultClassifyConnectionError", () => {
  describe("Vercel HTML 500 page (the real-world bug)", () => {
    it("does NOT classify as AuthFailed", () => {
      const result = defaultClassifyConnectionError(
        makeFailure({ status: 500, body: VERCEL_HTML_500, contentType: "text/html" }),
      )
      expect(result._tag).not.toBe("AuthFailed")
    })

    it("classifies as retryable TransportError", () => {
      const result = defaultClassifyConnectionError(
        makeFailure({ status: 500, body: VERCEL_HTML_500, contentType: "text/html" }),
      )
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") expect(result.retryable).toBe(true)
    })
  })

  describe("auth classification", () => {
    it("status 401 with empty body → AuthFailed", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 401, body: "" }))
      expect(result._tag).toBe("AuthFailed")
    })

    it("status 403 with empty body → AuthFailed", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 403, body: "" }))
      expect(result._tag).toBe("AuthFailed")
    })

    it("status 400 with structured JSON containing 'unauthorized' → AuthFailed", () => {
      const body = JSON.stringify({ error: { message: "Unauthorized: bad token", code: "invalid_token", type: "authentication_error" } })
      const result = defaultClassifyConnectionError(makeFailure({ status: 400, body }))
      expect(result._tag).toBe("AuthFailed")
    })

    it("status 500 with structured JSON containing 'forbidden' is NOT AuthFailed (only 4xx triggers)", () => {
      const body = JSON.stringify({ error: { message: "forbidden zone", code: "server_error" } })
      const result = defaultClassifyConnectionError(makeFailure({ status: 500, body }))
      expect(result._tag).not.toBe("AuthFailed")
    })

    it("status 500 with raw text body containing 'forbidden' is NOT AuthFailed", () => {
      const result = defaultClassifyConnectionError(
        makeFailure({ status: 500, body: "Some text mentioning forbidden access" }),
      )
      expect(result._tag).not.toBe("AuthFailed")
    })
  })

  describe("rate limiting", () => {
    it("status 429 → RateLimited", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 429, body: "" }))
      expect(result._tag).toBe("RateLimited")
    })

    it("status 429 with usage_limit_exceeded code → UsageLimitExceeded", () => {
      const body = JSON.stringify({ error: { message: "quota exceeded", code: "usage_limit_exceeded" } })
      const result = defaultClassifyConnectionError(makeFailure({ status: 429, body }))
      expect(result._tag).toBe("UsageLimitExceeded")
    })

    it("status 429 honors Retry-After seconds", () => {
      const headers = new Headers({ "retry-after": "5" })
      const result = defaultClassifyConnectionError({ status: 429, headers, body: "" })
      expect(result._tag).toBe("RateLimited")
      if (result._tag === "RateLimited") expect(result.retryAfterMs).toBe(5000)
    })
  })

  describe("context limit", () => {
    it("status 400 with structured 'prompt is too long' → ContextLimitExceeded", () => {
      const body = JSON.stringify({ error: { message: "prompt is too long", code: "context_length_exceeded" } })
      const result = defaultClassifyConnectionError(makeFailure({ status: 400, body }))
      expect(result._tag).toBe("ContextLimitExceeded")
    })

    it("status 400 with plain-text 'prompt is too long' (no JSON) → ContextLimitExceeded", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 400, body: "prompt is too long" }))
      expect(result._tag).toBe("ContextLimitExceeded")
    })

    it("HTML body containing 'maximum context length' is NOT ContextLimitExceeded", () => {
      const body = "<html><body>Some page mentioning maximum context length</body></html>"
      const result = defaultClassifyConnectionError(makeFailure({ status: 500, body }))
      expect(result._tag).not.toBe("ContextLimitExceeded")
    })
  })

  describe("server errors", () => {
    it("status 500 with empty body → retryable TransportError", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 500, body: "" }))
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") expect(result.retryable).toBe(true)
    })

    it("status 503 → retryable TransportError", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 503, body: "" }))
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") expect(result.retryable).toBe(true)
    })

    it("status 504 → retryable TransportError", () => {
      const result = defaultClassifyConnectionError(makeFailure({ status: 504, body: "" }))
      expect(result._tag).toBe("TransportError")
      if (result._tag === "TransportError") expect(result.retryable).toBe(true)
    })
  })

  describe("4xx fallthrough", () => {
    it("status 400 with no auth signal → InvalidRequest", () => {
      const body = JSON.stringify({ error: { message: "bad request", code: "invalid_body" } })
      const result = defaultClassifyConnectionError(makeFailure({ status: 400, body }))
      expect(result._tag).toBe("InvalidRequest")
    })
  })
})
