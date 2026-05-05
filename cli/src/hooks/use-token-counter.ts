import { useState, useEffect, useRef } from 'react'
import type { createCodingAgentClient } from '@magnitudedev/agent'

type AgentClient = Awaited<ReturnType<typeof createCodingAgentClient>>

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number | null
}

const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5':         { input: 3.00, output: 15.00 },
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00 },
  'claude-haiku-4-5':          { input: 0.80, output: 4.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'qwen2.5-vl-72b-instruct':   { input: 0.40, output: 1.20 },
}

function calculateCost(
  modelKey: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const prices =
    PRICE_PER_M[modelKey] ??
    Object.entries(PRICE_PER_M).find(([k]) => modelKey.startsWith(k))?.[1]

  if (!prices) return null
  return (inputTokens / 1_000_000) * prices.input +
         (outputTokens / 1_000_000) * prices.output
}

const ZERO: TokenCounts = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: null,
}

export function useTokenCounter(client: AgentClient | null): TokenCounts {
  const [counts, setCounts] = useState<TokenCounts>(ZERO)
  const accRef = useRef({ input: 0, output: 0, model: '' })

  useEffect(() => {
    if (!client) return

    const unsubscribe = client.onEvent((event) => {
      if (event.type === 'turn_outcome') {
        accRef.current.input += event.inputTokens ?? 0
        accRef.current.output += event.outputTokens ?? 0
        if (event.modelId) accRef.current.model = event.modelId

        const i = accRef.current.input
        const o = accRef.current.output
        setCounts({
          inputTokens: i,
          outputTokens: o,
          totalTokens: i + o,
          estimatedCost: calculateCost(accRef.current.model, i, o),
        })
      }
    })

    return () => {
      unsubscribe()
      accRef.current = { input: 0, output: 0, model: '' }
      setCounts(ZERO)
    }
  }, [client])

  return counts
}
