/**
 * Display projection — toolKey routing & no-duplicate steps.
 *
 * Asserts that:
 *  1. `tool_event ToolInputStarted` adds a ToolStep with the correct toolKey.
 *  2. `tool_event ToolExecutionStarted` does NOT add a duplicate step.
 *  3. The single step's toolKey equals the value carried on the event.
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  ProjectionBusTag,
  makeProjectionBusLayer,
  makeAmbientServiceLayer,
  FrameworkErrorPubSubLive,
  FrameworkErrorReporterLive,
} from '@magnitudedev/event-core'
import type { ProviderToolCallId, ToolCallId } from '@magnitudedev/ai'
import type { AppEvent } from '../src/events'
import { TurnProjection } from '../src/projections/turn'
import { AgentRoutingProjection } from '../src/projections/agent-routing'
import { AgentStatusProjection } from '../src/projections/agent-status'
import { DisplayProjection } from '../src/projections/display'
import { HarnessStateProjection } from '../src/projections/harness-state'
import { UserMessageResolutionProjection } from '../src/projections/user-message-resolution'
import type { DisplayState, ToolStep } from '../src/projections/display'

const ts = (n: number) => 1_700_200_000_000 + n

const runDisplay = async (events: AppEvent[]): Promise<DisplayState> => {
  const baseBusLayer = Layer.provideMerge(
    makeProjectionBusLayer<AppEvent>(),
    Layer.provide(FrameworkErrorReporterLive, FrameworkErrorPubSubLive),
  )
  const baseLayer = Layer.provideMerge(
    makeAmbientServiceLayer<AppEvent>(),
    baseBusLayer,
  )
  const runtimeLayer = Layer.mergeAll(
    FrameworkErrorPubSubLive,
    Layer.provide(FrameworkErrorReporterLive, FrameworkErrorPubSubLive),
    baseLayer,
    Layer.provide(TurnProjection.Layer, baseLayer),
    Layer.provide(AgentRoutingProjection.Layer, baseLayer),
    Layer.provide(AgentStatusProjection.Layer, baseLayer),
    Layer.provide(HarnessStateProjection.Layer, baseLayer),
    Layer.provide(UserMessageResolutionProjection.Layer, baseLayer),
    Layer.provide(DisplayProjection.Layer, baseLayer),
  )
  const program = Effect.gen(function* () {
    const bus = yield* (ProjectionBusTag<AppEvent>())
    const projection = yield* DisplayProjection.Tag
    for (const event of events) {
      yield* bus.processEvent(event as any)
    }
    return yield* projection.getFork(null)
  })
  return Effect.runPromise(program.pipe(Effect.provide(runtimeLayer)) as Effect.Effect<DisplayState>)
}

const turnId = 'turn-1'
const forkId = null
const toolCallId = 'call-1' as ToolCallId
const providerToolCallId = 'call-1' as ProviderToolCallId

describe('Display — toolKey routing & no-duplicate steps', () => {
  it("uses the toolKey carried on tool_event ToolInputStarted", async () => {
    const state = await runDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'c1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'fileTree',
        event: { _tag: 'ToolInputStarted', toolCallId, providerToolCallId, toolName: 'tree', toolKey: 'fileTree' },
      } as AppEvent,
    ])

    const block = state.messages.find(m => m.type === 'think_block')
    if (!block || block.type !== 'think_block') throw new Error('expected think block')
    const step = block.steps.find(s => s.id === toolCallId && s.type === 'tool') as ToolStep | undefined
    expect(step).toBeDefined()
    expect(step!.toolKey).toBe('fileTree')
  })

  it('does NOT add a duplicate step on tool_event ToolExecutionStarted', async () => {
    const state = await runDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'c1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'fileTree',
        event: { _tag: 'ToolInputStarted', toolCallId, providerToolCallId, toolName: 'tree', toolKey: 'fileTree' },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(3), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'fileTree',
        event: { _tag: 'ToolInputReady', toolCallId, providerToolCallId },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(4), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'fileTree',
        event: {
          _tag: 'ToolExecutionStarted',
          toolCallId,
          providerToolCallId,
          toolName: 'tree',
          toolKey: 'fileTree',
          input: { path: '.' },
          cached: false,
        },
      } as AppEvent,
    ])

    const block = state.messages.find(m => m.type === 'think_block')
    if (!block || block.type !== 'think_block') throw new Error('expected think block')
    const toolSteps = block.steps.filter(s => s.id === toolCallId && s.type === 'tool')
    expect(toolSteps.length).toBe(1)
  })

  it('skips rendering when toolKey is a hidden tool', async () => {
    const state = await runDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'c1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'createTask',
        event: { _tag: 'ToolInputStarted', toolCallId, providerToolCallId, toolName: 'createTask', toolKey: 'createTask' },
      } as AppEvent,
    ])

    const block = state.messages.find(m => m.type === 'think_block')
    if (!block || block.type !== 'think_block') {
      // No think block at all is also acceptable
      return
    }
    const step = block.steps.find(s => s.id === toolCallId)
    expect(step).toBeUndefined()
  })
})
