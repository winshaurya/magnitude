/**
 * Agent Communication Tool
 */

import { Effect, Schema } from 'effect'
import { defineHarnessTool } from '@magnitudedev/harness'
import { Fork, WorkerBusTag } from '@magnitudedev/event-core'
import { TurnContextTag } from '../engine/turn-context'
import { createId } from '@magnitudedev/generate-id'
import type { AppEvent } from '../events'

const { ForkContext } = Fork

const MessageWorkerOutput = Schema.Struct({
  ok: Schema.Boolean,
  yield: Schema.optional(Schema.Boolean),
})

export const messageWorkerTool = defineHarnessTool({
  definition: {
    name: 'messageWorker',
    description: 'Send a message to another agent worker.',
    inputSchema: Schema.Struct({
      agentId: Schema.String.annotations({ description: 'Agent ID of the worker to message' }),
      message: Schema.String.annotations({ description: 'Message content to send' }),
      yield: Schema.optional(Schema.Boolean.annotations({ description: 'When true, yield to this worker — the turn will not retrigger.' })),
    }),
    outputSchema: MessageWorkerOutput,
  },
  execute: (input, _ctx) =>
    Effect.gen(function* () {
      const { forkId } = yield* ForkContext
      const { turnId } = yield* TurnContextTag
      const bus = yield* WorkerBusTag<AppEvent>()
      const messageId = createId()

      yield* bus.publish({
        type: 'message_start',
        forkId,
        turnId,
        id: messageId,
        destination: { kind: 'worker', agentId: input.agentId },
      })

      yield* bus.publish({
        type: 'message_chunk',
        forkId,
        turnId,
        id: messageId,
        text: input.message,
      })

      yield* bus.publish({
        type: 'message_end',
        forkId,
        turnId,
        id: messageId,
      })

      return { ok: true, yield: input.yield || undefined }
    }),
})
