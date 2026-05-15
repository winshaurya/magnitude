import { Effect, Layer, ManagedRuntime } from 'effect'

import {
  AuthStorage,
  AuthStorageLive,
} from './auth'
import {
  CatalogCache,
  CatalogCacheLive,
} from './catalog-cache'
import {
  ConfigStorage,
  ConfigStorageLive,
  type ResolvedContextLimitPolicy,
} from './config'
import { LogStorage, LogStorageLive } from './logs'
import { MemoryStorage, MemoryStorageLive } from './memory'
import {
  ProjectStorageLiveFromCwd,
  GlobalStorageLive,
  VersionLive,
} from './services'
import { makeProjectStoragePaths } from './paths'
import { SessionStorage, SessionStorageLive } from './sessions'

import { TraceStorage, TraceStorageLive } from './traces'
import type {
  AuthInfo,
  ContextLimitPolicy,
  MagnitudeConfig,
  MemoryExtractionJobRecord,
  OAuthAuth,
  StoredLogEntry,
  StoredSessionMeta,
} from './types'

export type AllStorageServices =
  | AuthStorage
  | CatalogCache
  | ConfigStorage
  | LogStorage
  | MemoryStorage
  | SessionStorage
  | TraceStorage

export interface StorageClient<TSlot extends string = string> {
  config: {
    getContextLimitPolicy(): Promise<ResolvedContextLimitPolicy>
    setContextLimitPolicy(
      policy: ContextLimitPolicy
    ): Promise<void>

    loadFull(): Promise<MagnitudeConfig>
    updateFull(
      fn: (c: MagnitudeConfig) => MagnitudeConfig
    ): Promise<MagnitudeConfig>
  }

  auth: {
    get(providerId: string): Promise<AuthInfo | undefined>
    set(providerId: string, auth: AuthInfo): Promise<void>
    remove(providerId: string): Promise<void>
    getStoredApiKey(providerId: string): Promise<string | undefined>
    getOAuth(providerId: string): Promise<OAuthAuth | undefined>
  }

  sessions: {
    createId(now?: Date): string
    list(opts?: { timestampOnly?: boolean }): Promise<string[]>
    findLatest(opts?: { timestampOnly?: boolean }): Promise<string | null>
    readMeta(sessionId: string): Promise<StoredSessionMeta | null>
    writeMeta(sessionId: string, meta: StoredSessionMeta): Promise<void>
    updateMeta(
      sessionId: string,
      updater: (m: StoredSessionMeta | null) => StoredSessionMeta
    ): Promise<StoredSessionMeta>
    readEvents<T>(sessionId: string): Promise<T[]>
    appendEvents<T>(sessionId: string, events: T[]): Promise<void>
    getEventsPath(sessionId: string): string
    createScratchpad(sessionId: string): Promise<string>
    getScratchpadPath(sessionId: string): string
  }

  memoryJobs: {
    enqueue(job: MemoryExtractionJobRecord): Promise<string>
    list(): Promise<string[]>
    listIds(): Promise<string[]>
    read(ref: { jobId: string } | { filePath: string }): Promise<MemoryExtractionJobRecord>
    markRunning(jobId: string, job: MemoryExtractionJobRecord): Promise<void>
    markPending(jobId: string, job: MemoryExtractionJobRecord): Promise<void>
    remove(jobId: string): Promise<void>
    resolvePath(jobId: string): string
  }

  memory: {
    ensureFile(template?: string): Promise<void>
    read(): Promise<string>
    write(content: string): Promise<void>
    getPath(): string
  }

  logs: {
    append(sessionId: string, entries: StoredLogEntry[]): Promise<void>
    clear(sessionId: string): Promise<void>
    getPath(sessionId: string): string
  }

  // Traces are generic at the storage layer because concrete trace types
  // (AgentTrace, TraceSessionMeta) live in @magnitudedev/tracing which depends on storage.
  // Consumers should provide their own trace types.
  traces: {
    initSession<M = Record<string, unknown>>(traceId: string, meta: M): Promise<void>
    append<T = Record<string, unknown>>(traceId: string, traces: T[]): Promise<void>
    readMeta<M = Record<string, unknown>>(traceId: string): Promise<M>
    updateMeta<M = Record<string, unknown>>(
      traceId: string,
      updater: (m: M) => M
    ): Promise<void>
    getDirPath(traceId: string): string
  }

  readonly layer: Layer.Layer<AllStorageServices>
}

export async function createStorageClient<TSlot extends string = string>(options?: {
  cwd?: string
  currentVersion?: string
}): Promise<StorageClient<TSlot>> {
  const cwd = options?.cwd ?? process.cwd()
  const currentVersion = options?.currentVersion ?? 'unknown'
  const projectPaths = makeProjectStoragePaths(cwd)

  const globalLayer = Layer.mergeAll(
    ConfigStorageLive,
    AuthStorageLive,
    CatalogCacheLive,
    SessionStorageLive(),
    LogStorageLive,
    TraceStorageLive
  ).pipe(
    Layer.provide(Layer.mergeAll(GlobalStorageLive, VersionLive(currentVersion)))
  )

  const projectLayer = Layer.mergeAll(
    MemoryStorageLive
  ).pipe(Layer.provide(ProjectStorageLiveFromCwd(cwd)))

  const layer = Layer.mergeAll(globalLayer, projectLayer)
  const runtime = ManagedRuntime.make(layer)
  const run = <A, E = never>(
    effect: Effect.Effect<A, E, AllStorageServices>
  ) => runtime.runPromise(effect)

  return {
    config: {
      getContextLimitPolicy() {
        return run(Effect.flatMap(ConfigStorage, (s) => s.getContextLimitPolicy()))
      },

      setContextLimitPolicy(policy) {
        return run(Effect.flatMap(ConfigStorage, (s) => s.setContextLimitPolicy(policy)))
      },


      loadFull() {
        return run(Effect.flatMap(ConfigStorage, (s) => s.load()))
      },

      updateFull(fn) {
        return run(Effect.flatMap(ConfigStorage, (s) => s.update(fn)))
      },
    },

    auth: {
      get(providerId) {
        return run(Effect.flatMap(AuthStorage, (s) => s.get(providerId)))
      },

      set(providerId, auth) {
        return run(Effect.flatMap(AuthStorage, (s) => s.set(providerId, auth)))
      },

      remove(providerId) {
        return run(Effect.flatMap(AuthStorage, (s) => s.remove(providerId)))
      },

      async getStoredApiKey(providerId) {
        const auth = await run(Effect.flatMap(AuthStorage, (s) => s.get(providerId)))
        return auth?.type === 'api' ? auth.key : undefined
      },

      async getOAuth(providerId) {
        const auth = await run(Effect.flatMap(AuthStorage, (s) => s.get(providerId)))
        return auth?.type === 'oauth' ? auth : undefined
      },
    },

    sessions: {
      createId: () =>
        runtime.runSync(
          Effect.map(SessionStorage, (s) => s.createTimestampSessionId())
        ),
      list: (opts) =>
        run(Effect.flatMap(SessionStorage, (s) => s.listSessionIds(opts))),
      findLatest: (opts) =>
        run(Effect.flatMap(SessionStorage, (s) => s.findLatestSessionId(opts))),
      readMeta: (sessionId) =>
        run(Effect.flatMap(SessionStorage, (s) => s.readMeta(sessionId))),
      writeMeta: (sessionId, meta) =>
        run(Effect.flatMap(SessionStorage, (s) => s.writeMeta(sessionId, meta))),
      updateMeta: (sessionId, updater) =>
        run(
          Effect.flatMap(SessionStorage, (s) =>
            s.updateMeta(sessionId, (current) => updater(current))
          )
        ),
      readEvents: <T>(sessionId: string) =>
        run(Effect.flatMap(SessionStorage, (s) => s.readEvents<T>(sessionId))),
      appendEvents: <T>(sessionId: string, events: T[]) =>
        run(Effect.flatMap(SessionStorage, (s) => s.appendEvents<T>(sessionId, events))),
      getEventsPath: (sessionId: string) =>
        runtime.runSync(Effect.map(SessionStorage, (s) => s.paths.sessionEventsFile(sessionId))),
      createScratchpad: (sessionId) =>
        run(
          Effect.flatMap(SessionStorage, (s) =>
            s.createSessionScratchpad(sessionId)
          )
        ),
      getScratchpadPath: (sessionId) =>
        runtime.runSync(Effect.map(SessionStorage, (s) => s.paths.sessionScratchpad(sessionId))),
    },

    memoryJobs: {
      enqueue: (job) =>
        run(Effect.flatMap(SessionStorage, (s) => s.writePendingMemoryJob(job))),
      list: () =>
        run(Effect.flatMap(SessionStorage, (s) => s.listPendingMemoryJobFiles())),
      listIds: () =>
        run(Effect.flatMap(SessionStorage, (s) => s.listPendingMemoryJobIds())),
      read: (ref) =>
        run(Effect.flatMap(SessionStorage, (s) => s.readPendingMemoryJob(ref))),
      markRunning: async (jobId, job) => {
        await run(
          Effect.flatMap(SessionStorage, (s) =>
            s.markPendingMemoryJobRunning({ jobId }, job)
          )
        )
      },
      markPending: async (jobId, job) => {
        await run(
          Effect.flatMap(SessionStorage, (s) =>
            s.markPendingMemoryJobPending({ jobId }, job)
          )
        )
      },
      remove: (jobId) =>
        run(Effect.flatMap(SessionStorage, (s) => s.removePendingMemoryJob({ jobId }))),
      resolvePath: (jobId) =>
        runtime.runSync(
          Effect.map(SessionStorage, (s) => s.resolvePendingMemoryJobPath(jobId))
        ),
    },

    memory: {
      ensureFile: async (template) => {
        await run(Effect.flatMap(MemoryStorage, (s) => s.ensureFile(template)))
      },
      read: () => run(Effect.flatMap(MemoryStorage, (s) => s.read())),
      write: (content) => run(Effect.flatMap(MemoryStorage, (s) => s.write(content))),
      getPath: () => projectPaths.memoryFile,
    },

    logs: {
      append: (sessionId, entries) =>
        run(Effect.flatMap(LogStorage, (s) => s.appendSession(sessionId, entries))),
      clear: (sessionId) =>
        run(Effect.flatMap(LogStorage, (s) => s.clearSession(sessionId))),
      getPath: (sessionId) =>
        runtime.runSync(Effect.map(LogStorage, (s) => s.getSessionPath(sessionId))),
    },

    traces: {
      initSession: <M = Record<string, unknown>>(traceId: string, meta: M) =>
        run(
          Effect.flatMap(TraceStorage, (s) =>
            s.initSession(traceId, meta as Record<string, unknown>)
          )
        ),
      append: <T = Record<string, unknown>>(traceId: string, traces: T[]) =>
        run(
          Effect.flatMap(TraceStorage, (s) =>
            s.append(traceId, traces as Record<string, unknown>[])
          )
        ),
      readMeta: async <M = Record<string, unknown>>(traceId: string) => {
        const meta = await run(
          Effect.flatMap(TraceStorage, (s) =>
            s.readMeta<Record<string, unknown>>(traceId)
          )
        )
        return (meta ?? {}) as M
      },
      updateMeta: async <M = Record<string, unknown>>(
        traceId: string,
        updater: (m: M) => M
      ) => {
        await run(
          Effect.flatMap(TraceStorage, (s) =>
            s.updateMeta<Record<string, unknown>>(traceId, (current) =>
              updater(((current ?? {}) as M)) as Record<string, unknown>
            )
          )
        )
      },
      getDirPath: (traceId) =>
        runtime.runSync(Effect.map(TraceStorage, (s) => s.getDirPath(traceId))),
    },

    layer,
  }
}