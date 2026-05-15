import { useCallback, useEffect, useState } from 'react'
import { isEnvFlagOn } from '@magnitudedev/magnitude-client'
import { useStorage } from '../providers/storage-provider'

const PROVIDER_ID = 'magnitude'

export type MagnitudeAuthSource = 'config' | 'env' | 'env-local' | 'none'

export interface MagnitudeAuthState {
  source: MagnitudeAuthSource
  key: string | null
  /** Name of the active env var when source is 'env' or 'env-local'. Null otherwise. */
  envVarName: string | null
  loaded: boolean
  refresh: () => Promise<void>
  save: (key: string) => Promise<void>
  clear: () => Promise<void>
}

interface Resolved {
  source: MagnitudeAuthSource
  key: string | null
  envVarName: string | null
}

async function resolveAuth(getStoredKey: () => Promise<string | undefined>): Promise<Resolved> {
  const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)

  // In local mode, always prefer the local env var over stored config
  if (useLocal) {
    const localKey = process.env.MAGNITUDE_LOCAL_API_KEY
    if (localKey && localKey.trim()) {
      return { source: 'env-local', key: localKey, envVarName: 'MAGNITUDE_LOCAL_API_KEY' }
    }
  }

  const stored = await getStoredKey()
  if (stored && stored.trim()) {
    return { source: 'config', key: stored, envVarName: null }
  }

  const envKey = process.env.MAGNITUDE_API_KEY
  if (envKey && envKey.trim()) {
    return { source: 'env', key: envKey, envVarName: 'MAGNITUDE_API_KEY' }
  }

  return { source: 'none', key: null, envVarName: null }
}

export function useMagnitudeAuth(): MagnitudeAuthState {
  const storage = useStorage()
  const [resolved, setResolved] = useState<Resolved>({ source: 'none', key: null, envVarName: null })
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const next = await resolveAuth(() => storage.auth.getStoredApiKey(PROVIDER_ID))
    setResolved(next)
    setLoaded(true)
  }, [storage])

  useEffect(() => {
    let cancelled = false
    resolveAuth(() => storage.auth.getStoredApiKey(PROVIDER_ID)).then((next) => {
      if (cancelled) return
      setResolved(next)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [storage])

  const save = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    await storage.auth.set(PROVIDER_ID, { type: 'api', key: trimmed })
    await refresh()
  }, [storage, refresh])

  const clear = useCallback(async () => {
    await storage.auth.remove(PROVIDER_ID)
    await refresh()
  }, [storage, refresh])

  return {
    source: resolved.source,
    key: resolved.key,
    envVarName: resolved.envVarName,
    loaded,
    refresh,
    save,
    clear,
  }
}
