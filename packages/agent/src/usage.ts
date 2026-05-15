import { Effect } from 'effect'
import { FetchHttpClient } from '@effect/platform'
import { createMagnitudeClient } from '@magnitudedev/magnitude-client'
import type { BalanceQuery } from '@magnitudedev/magnitude-client'
import type { BalanceResponse, UsagePeriod } from '@magnitudedev/magnitude-client'

export type { BalanceResponse, UsagePeriod } from '@magnitudedev/magnitude-client'

export interface FetchBalanceOptions {
  readonly period?: UsagePeriod
  readonly days?: number
  readonly tz?: string
}

export async function fetchBalance(
  apiKey?: string,
  endpoint?: string,
  options?: FetchBalanceOptions,
): Promise<BalanceResponse> {
  const client = createMagnitudeClient({ apiKey, endpoint })
  const query: BalanceQuery = {
    period: options?.period,
    days: options?.days,
    tz: options?.tz,
  }
  return Effect.runPromise(
    client.balance(query).pipe(Effect.provide(FetchHttpClient.layer)),
  )
}
