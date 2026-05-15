import { Context, Effect, Duration } from "effect"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import { Auth, type AuthApplicator } from "@magnitudedev/ai"
import { CLIENT_PLATFORM, CLIENT_SHELL, HEADER_PLATFORM, HEADER_SHELL, HEADER_SESSION_ID } from "./client-headers"
import { isEnvFlagOn } from "./env"
import type { BalanceResponse, RoleId, UsagePeriod } from "./contract"
import { createModelCatalog, type ModelCatalog } from "./catalog"
import { createRoleSpec, type MagnitudeCallOptions, type MagnitudeStreamError } from "./models"
import type { MagnitudeConnectionError } from "./errors"
import type { BoundModel, ModelCapabilities as AIModelCapabilities, ImagePlaceholderConfig } from "@magnitudedev/ai"

// =============================================================================
// Web Search Types
// =============================================================================

export interface WebSearchResult {
  readonly text: string
  readonly sources: ReadonlyArray<{ readonly title: string; readonly url: string }>
  readonly data?: unknown
}

export class WebSearchError {
  readonly _tag = "WebSearchError"
  constructor(readonly message: string) {}
}

// =============================================================================
// Client Config & Factory
// =============================================================================

export interface MagnitudeClientConfig {
  readonly apiKey?: string
  readonly endpoint?: string
  readonly sessionId?: string
}

const DEFAULT_ENDPOINT = "https://app.magnitude.dev/api/v1"
const LOCAL_ENDPOINT = "http://localhost:3000/api/v1"

export interface RoleOptions {
  readonly defaults?: MagnitudeCallOptions
  readonly capabilities?: AIModelCapabilities
  readonly imagePlaceholders?: ImagePlaceholderConfig
}

export interface BalanceQuery {
  readonly period?: UsagePeriod
  readonly days?: number
  readonly tz?: string
}

export interface MagnitudeClientShape {
  readonly auth: AuthApplicator
  readonly catalog: ModelCatalog
  readonly role: (id: RoleId, options?: RoleOptions) => BoundModel<MagnitudeCallOptions, MagnitudeConnectionError, MagnitudeStreamError>
  readonly webSearch: (
    query: string,
    schema?: Record<string, unknown>
  ) => Effect.Effect<WebSearchResult, WebSearchError, HttpClient.HttpClient>
  readonly balance: (query?: BalanceQuery) => Effect.Effect<BalanceResponse, Error, HttpClient.HttpClient>
}

export class MagnitudeClient extends Context.Tag("MagnitudeClient")<
  MagnitudeClient,
  MagnitudeClientShape
>() {}

export function createMagnitudeClient(config?: MagnitudeClientConfig): MagnitudeClientShape {
  const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)
  const apiKey = config?.apiKey ?? (useLocal ? process.env.MAGNITUDE_LOCAL_API_KEY : undefined) ?? process.env.MAGNITUDE_API_KEY
  if (!apiKey) throw new Error(
    useLocal
      ? "No API key provided. Set MAGNITUDE_LOCAL_API_KEY (or MAGNITUDE_API_KEY) environment variable, or pass apiKey in config."
      : "No API key provided. Pass apiKey in config or set MAGNITUDE_API_KEY environment variable."
  )
  const endpoint = config?.endpoint ?? (useLocal ? LOCAL_ENDPOINT : DEFAULT_ENDPOINT)
  const sessionId = config?.sessionId ?? null
  const auth = Auth.bearer(apiKey)

  // Compose auth with client headers so every request includes platform/shell/sessionId
  const authWithHeaders: AuthApplicator = (headers) => {
    auth(headers)
    headers.set(HEADER_PLATFORM, CLIENT_PLATFORM)
    headers.set(HEADER_SHELL, CLIENT_SHELL)
    if (sessionId) headers.set(HEADER_SESSION_ID, sessionId)
  }

  const catalog = createModelCatalog({ endpoint, auth: authWithHeaders })

  return {
    auth: authWithHeaders,
    catalog,

    role: (id: RoleId, options?: RoleOptions) => {
      const spec = createRoleSpec(id, endpoint, options?.capabilities)
      return spec.bind({ auth: authWithHeaders, defaults: options?.defaults, imagePlaceholders: options?.imagePlaceholders })
    },

    /** Fetch balance + usage summary for the authenticated user */
    balance: (query?: BalanceQuery) => Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const headers = new Headers()
      authWithHeaders(headers)
      const headerRecord: Record<string, string> = {}
      headers.forEach((value, key) => { headerRecord[key] = value })

      const params = new URLSearchParams()
      if (query?.period) params.set("period", query.period)
      if (query?.days != null) params.set("days", String(query.days))
      if (query?.tz) params.set("tz", query.tz)
      const qs = params.toString()
      const url = `${endpoint}/balance${qs ? `?${qs}` : ""}`

      const request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeaders(headerRecord),
      )
      const response = yield* http.execute(request).pipe(
        Effect.mapError((err) => new Error(`Failed to fetch balance: ${err.message}`)),
      )
      if (response.status < 200 || response.status >= 300) {
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
        return yield* Effect.fail(new Error(`Failed to fetch balance: HTTP ${response.status} — ${body}`))
      }
      const text = yield* response.text.pipe(
        Effect.mapError((err) => new Error(`Failed to read balance response: ${err}`)),
      )
      try {
        return JSON.parse(text) as BalanceResponse
      } catch {
        return yield* Effect.fail(new Error(`Failed to parse balance response: ${text.slice(0, 200)}`))
      }
    }),

    /** Search the web via Magnitude API */
    webSearch: (query, schema) =>
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        const headers = new Headers()
        authWithHeaders(headers)

        const headerRecord: Record<string, string> = {}
        headers.forEach((value, key) => {
          headerRecord[key] = value
        })
        headerRecord["Content-Type"] = "application/json"

        const body = schema ? { query, schema } : { query }

        const request = HttpClientRequest.post(`${endpoint}/web-search`).pipe(
          HttpClientRequest.setHeaders(headerRecord),
          HttpClientRequest.bodyJson(body),
        )

        const response = yield* Effect.flatMap(
          request,
          (req) => http.execute(req)
        ).pipe(
          Effect.mapError((err) => new WebSearchError(`Request failed: ${err}`)),
          Effect.timeoutFail({
            onTimeout: () => new WebSearchError("Request timed out after 10 seconds"),
            duration: Duration.seconds(10),
          }),
        )

        if (response.status < 200 || response.status >= 300) {
          const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
          return yield* Effect.fail(new WebSearchError(`HTTP ${response.status}: ${text}`))
        }

        const text = yield* response.text.pipe(
          Effect.mapError((err) => new WebSearchError(`Failed to read response: ${err}`)),
        )

        let parsed: { text: string; sources: Array<{ title: string; url: string }>; data?: unknown }
        try {
          parsed = JSON.parse(text)
        } catch {
          return yield* Effect.fail(new WebSearchError(`Failed to parse response: ${text.slice(0, 200)}`))
        }

        return {
          text: parsed.text,
          sources: parsed.sources,
          data: parsed.data,
        } satisfies WebSearchResult
      }),
  }
}
