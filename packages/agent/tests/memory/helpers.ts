import { Effect } from 'effect'
import { SessionContextProjection } from '../../src/projections/session-context'
import { AgentStatusProjection } from '../../src/projections/agent-status'
import { WindowProjection, type ForkWindowState, type WindowEntry } from '../../src/window'
import { windowToPrompt } from '../../src/prompts/window-to-prompt'
import { createToolResultFormatter } from '@magnitudedev/harness'
import { leaderToolkit } from '../../src/tools/toolkits'
import { TestHarness } from '../../src/test-harness/harness'
import { createId } from '../../src/util/id'

const leaderFormatter = createToolResultFormatter(leaderToolkit)

export function getRootMemory(h: Effect.Effect.Success<typeof TestHarness>) {
  return h.projectionFork(WindowProjection.Tag, null)
}

export function sendUserMessage(h: Effect.Effect.Success<typeof TestHarness>, options: {
  text: string
  timestamp: number
  forkId?: string | null
  attachments?: any[]
}) {
  const forkId = options.forkId ?? null
  const timestamp = options.timestamp
  return Effect.gen(function* () {
    const messageId = createId()
    yield* h.send({
      type: 'user_message',
      messageId,
      forkId,
      timestamp,
      content: [{ _tag: 'TextPart', text: options.text }],
      attachments: options.attachments ?? [],
      mode: 'text',
      synthetic: false,
      taskMode: false,
    })
    yield* h.wait.event('user_message_ready', (e) => e.messageId === messageId)
  })
}

export function lastInboxMessage(memory: ForkWindowState): WindowEntry | undefined {
  for (let i = memory.messages.length - 1; i >= 0; i--) {
    if (memory.messages[i].type === 'context') return memory.messages[i]
  }
  return undefined
}

export function inboxMessages(memory: ForkWindowState): WindowEntry[] {
  return memory.messages.filter(m => m.type === 'context')
}

export function snapshotMessageRefs(memory: ForkWindowState): { refs: readonly WindowEntry[], json: string } {
  return {
    refs: memory.messages,
    json: JSON.stringify(memory.messages),
  }
}

export function assertPrefixUnchanged(
  before: { refs: readonly WindowEntry[], json: string },
  after: ForkWindowState,
) {
  const beforeCount = before.refs.length
  for (let i = 0; i < beforeCount; i++) {
    if (after.messages[i] !== before.refs[i]) {
      throw new Error(`Message at index ${i} was mutated (reference changed)`)
    }
  }
  const afterPrefixJson = JSON.stringify(after.messages.slice(0, beforeCount))
  if (afterPrefixJson !== before.json) {
    throw new Error('Message prefix content was mutated')
  }
}

export function getRenderedUserText(h: Effect.Effect.Success<typeof TestHarness>) {
  return Effect.gen(function* () {
    const memory = yield* h.projectionFork(WindowProjection.Tag, null)
    const session = yield* h.runEffect(Effect.flatMap(SessionContextProjection.Tag, p => p.get))
    const timezone = session.context?.timezone ?? null
    const agentStatus = yield* h.projection(AgentStatusProjection.Tag)
    const prompt = windowToPrompt(memory, '', timezone, agentStatus, leaderFormatter)
    return prompt.messages
      .filter(m => m._tag === 'UserMessage')
      .map(m => m.parts.map(part => part._tag === 'TextPart' ? part.text : '[image]').join(''))
      .join('\n')
  })
}
