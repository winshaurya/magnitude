/**
 * Compaction signals — defined separately to avoid circular imports.
 * CompactionProjection reads WindowProjection, so WindowProjection
 * cannot import CompactionProjection. These signals are shared between both.
 */

import { Signal } from '@magnitudedev/event-core'
import type { CompletedTurn } from '../window/types'
import type { CompactionOutcome, SessionContext } from '../events'

export const compactionSignals = {
  shouldCompactChanged: Signal.create<{ forkId: string | null; shouldCompact: boolean }>('Compaction/shouldCompactChanged'),
  compactionBlockingChanged: Signal.create<{ forkId: string | null; blocking: boolean }>('Compaction/compactionBlockingChanged'),
  contextLimitBlockedChanged: Signal.create<{ forkId: string | null; blocked: boolean }>('Compaction/contextLimitBlockedChanged'),
  compactionInjected: Signal.create<{
    forkId: string | null
    turn: CompletedTurn
    compactionOutcome: CompactionOutcome
    compactedMessageCount: number
    inputTokens: number | null
    outputTokens: number | null
    refreshedContext: SessionContext | null
  }>('Compaction/compactionInjected'),
}
