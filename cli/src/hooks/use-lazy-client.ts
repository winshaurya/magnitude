import { useRef, useState, useCallback, useEffect } from 'react'
import type { createCodingAgentClient } from '@magnitudedev/agent'

type AgentClient = Awaited<ReturnType<typeof createCodingAgentClient>>

// TODO: Simplify API — take a single factory `() => Promise<{ client, scratchpadPath }>` as the only argument.
// The hook should call it lazily on first send/ensureReady, cache the result, and handle dispose on unmount.
// This would eliminate setFactory/setClient and let the consumer just pass a creation function.
// Blocked because the current setupClient in app.tsx has extensive event subscription logic that
// would need to be moved into separate useEffects keyed on `client` before the factory can be self-contained.
export function useLazyClient() {
  const [client, setClientState] = useState<AgentClient | null>(null)
  const [scratchpadPath, setScratchpadPath] = useState<string | null>(null)
  const factoryRef = useRef<(() => Promise<AgentClient>) | null>(null)
  const initPromiseRef = useRef<Promise<{ client: AgentClient; scratchpadPath: string | null }> | null>(null)
  const clientRef = useRef<AgentClient | null>(null)
  const scratchpadPathRef = useRef<string | null>(null)

  const ensureReady = useCallback(async (): Promise<{ client: AgentClient; scratchpadPath: string | null }> => {
    if (clientRef.current) {
      return { client: clientRef.current, scratchpadPath: scratchpadPathRef.current }
    }
    if (initPromiseRef.current) {
      return initPromiseRef.current
    }
    if (factoryRef.current) {
      const factory = factoryRef.current
      factoryRef.current = null
      const promise = factory().then((newClient) => {
        return { client: newClient, scratchpadPath: scratchpadPathRef.current }
      })
      initPromiseRef.current = promise
      return promise
    }
    throw new Error('No client and no factory available')
  }, [])

  const send = useCallback(
    (event: Parameters<AgentClient['send']>[0]) => {
      if (clientRef.current) {
        clientRef.current.send(event)
        return
      }
      ensureReady()
        .then(({ client }) => {
          client.send(event)
        })
        .catch((err) => {
          console.error('Failed to create agent client for send:', err)
        })
    },
    [ensureReady],
  )

  const setFactory = useCallback((factory: (() => Promise<AgentClient>) | null) => {
    factoryRef.current = factory
    initPromiseRef.current = null
  }, [])

  const setClient = useCallback((newClient: AgentClient, wp: string | null) => {
    clientRef.current = newClient
    scratchpadPathRef.current = wp
    setClientState(newClient)
    setScratchpadPath(wp)
  }, [])

  return { client, scratchpadPath, send, ensureReady, setFactory, setClient }
}
