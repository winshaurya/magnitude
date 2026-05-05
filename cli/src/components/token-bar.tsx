import React from 'react'
import { Text, Box } from 'ink'
import { TokenCounts } from '../hooks/use-token-counter'
import { useTheme } from '../hooks/use-theme'

interface Props {
  counts: TokenCounts
  visible: boolean
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01)  return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export function TokenBar({ counts, visible }: Props) {
  const theme = useTheme()
  if (!visible || counts.totalTokens === 0) return null

  const { inputTokens, outputTokens, totalTokens, estimatedCost } = counts

  return (
    <Box gap={1}>
      <Text color={theme.muted}>
        {formatTokens(totalTokens)} tok
      </Text>
      <Text color={theme.muted} dimColor>
        ({formatTokens(inputTokens)}↑ {formatTokens(outputTokens)}↓)
      </Text>
      {estimatedCost !== null && (
        <Text color={theme.warning}>
          {formatCost(estimatedCost)}
        </Text>
      )}
    </Box>
  )
}
