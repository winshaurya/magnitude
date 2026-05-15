import { createStorageClient } from './src/index'
import { computeContextLimits, DEFAULT_CONTEXT_LIMIT_POLICY, resolveContextLimitPolicy } from './src/config/index'
import { MagnitudeConfigSchema } from './src/types'
import { Schema } from 'effect'

const FALLBACK_PROFILE = {
  contextWindow: 200_000,
  maxOutputTokens: 16_384,
}

async function main() {
  const storage = await createStorageClient()
  
  // 1. What policy does storage return?
  const policy = await storage.config.getContextLimitPolicy()
  console.log('1. Policy from storage:', JSON.stringify(policy))
  
  // 2. What softCap does computeContextLimits produce?
  const hardCap = FALLBACK_PROFILE.contextWindow - FALLBACK_PROFILE.maxOutputTokens
  const { softCap } = computeContextLimits(hardCap, policy)
  console.log('2. hardCap:', hardCap, 'softCap:', softCap)
  
  // 3. What does DEFAULT_CONTEXT_LIMIT_POLICY produce?
  const defaultLimits = computeContextLimits(hardCap, DEFAULT_CONTEXT_LIMIT_POLICY)
  console.log('3. Default policy softCap:', defaultLimits.softCap)
  
  // 4. What does the raw config file have?
  const raw = await Bun.file(`${process.env.HOME}/.magnitude/config.json`).json()
  console.log('4. Raw config contextLimits:', JSON.stringify(raw.contextLimits))
  
  // 5. What does Schema.decode produce?
  const decoded = Schema.decodeUnknownSync(MagnitudeConfigSchema)(raw)
  console.log('5. Decoded config:', JSON.stringify(decoded))
  
  // 6. What does resolveContextLimitPolicy produce?
  const resolved = resolveContextLimitPolicy(decoded)
  console.log('6. Resolved policy:', JSON.stringify(resolved))
}

main().catch(console.error)
