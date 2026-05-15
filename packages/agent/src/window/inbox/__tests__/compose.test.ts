import { describe, expect, test } from 'vitest'
import {
  toTimelineAgentBlock,
  toTimelineObservation,
  toTimelineTaskUpdate,
  toTimelineLifecycleHook,
  toTimelineSubagentUserKilled,
  toTimelineUserMessage,
  toTimelineUserPresence,
  toTimelineUserToAgent,
} from '../compose'
import type { UserPart } from '@magnitudedev/ai'
import type { AgentAtom, TimelineAttachment } from '../types'

const TS = 1711641600000

describe('inbox compose', () => {
  test('toTimeline* constructors set correct kinds', () => {
    const attachments: readonly TimelineAttachment[] = [{ kind: 'mention', path: 'a.ts', contentType: 'text' }]
    const atoms: readonly AgentAtom[] = [{ kind: 'thought', timestamp: TS, text: 'thinking' }]
    const parts: readonly UserPart[] = [{ _tag: 'TextPart', text: 'obs' }]

    expect(toTimelineUserMessage({ timestamp: TS, text: 'u', attachments }).kind).toBe('user_message')
    expect(toTimelineUserToAgent({ timestamp: TS, agentId: 'a1', text: 'u2a' }).kind).toBe('user_to_agent')
    expect(toTimelineAgentBlock({
      timestamp: TS,
      firstAtomTimestamp: TS,
      lastAtomTimestamp: TS,
      agentId: 'a1',
      role: 'engineer',
      atoms,
    }).kind).toBe('agent_block')
    expect(toTimelineSubagentUserKilled({ timestamp: TS, agentId: 'a1', agentType: 'builder' }).kind).toBe('subagent_user_killed')
    expect(toTimelineUserPresence({ timestamp: TS, text: 'present', confirmed: true }).kind).toBe('user_presence')
    expect(
      toTimelineLifecycleHook({
        timestamp: TS,
        agentId: 'a1',
        role: 'engineer',
        hookType: 'spawn',
      }).kind,
    ).toBe('lifecycle_hook')
    expect(
      toTimelineTaskUpdate({
        timestamp: TS,
        action: 'status_changed',
        taskId: 't1',
        previousStatus: 'pending',
        nextStatus: 'completed',
      }).kind,
    ).toBe('task_update')
    expect(toTimelineObservation({ timestamp: TS, parts }).kind).toBe('observation')
  })

  test('readonly arrays are preserved by reference', () => {
    const attachments: readonly TimelineAttachment[] = [{ kind: 'mention', path: 'x', contentType: 'text' }]
    const atoms: readonly AgentAtom[] = [{ kind: 'thought', timestamp: TS, text: 't' }]
    const parts: readonly UserPart[] = [{
      _tag: 'ImagePart',
      data: 'abc',
      mediaType: 'image/png',
    }]

    const msg = toTimelineUserMessage({ timestamp: TS, text: 'hello', attachments })
    const block = toTimelineAgentBlock({
      timestamp: TS,
      firstAtomTimestamp: TS,
      lastAtomTimestamp: TS,
      agentId: 'a',
      role: 'engineer',
      atoms,
    })
    const obs = toTimelineObservation({ timestamp: TS, parts })

    if (msg.kind !== 'user_message') throw new Error('expected user_message')
    if (block.kind !== 'agent_block') throw new Error('expected agent_block')
    if (obs.kind !== 'observation') throw new Error('expected observation')

    expect(msg.attachments).toBe(attachments)
    expect(block.atoms).toBe(atoms)
    expect(obs.parts).toBe(parts)
  })

  test('handles edge cases: empty atoms and undefined optional fields', () => {
    const block = toTimelineAgentBlock({
      timestamp: TS,
      firstAtomTimestamp: TS,
      lastAtomTimestamp: TS,
      agentId: 'a',
      role: 'engineer',
      atoms: [],
    })
    const update = toTimelineTaskUpdate({
      timestamp: TS,
      action: 'created',
      taskId: 't1',
    })

    if (block.kind !== 'agent_block') throw new Error('expected agent_block')
    if (update.kind !== 'task_update') throw new Error('expected task_update')

    expect(block.atoms).toEqual([])
    expect(update.title).toBeUndefined()
    expect(update.previousStatus).toBeUndefined()
    expect(update.nextStatus).toBeUndefined()
    expect(update.cancelledCount).toBeUndefined()
  })
})
