import { Context, Ref } from 'effect'

export interface CompactResult {
  readonly summary: string
  readonly reflection: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>
}

export interface CompactionContext {
  readonly isCompacting: true
  readonly resultRef: Ref.Ref<CompactResult | null>
  readonly maxPayloadTokens: number
}

export class CompactionContextTag extends Context.Tag('CompactionContext')<
  CompactionContextTag,
  CompactionContext
>() {}
