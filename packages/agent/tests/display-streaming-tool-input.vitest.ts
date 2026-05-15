/**
 * Display projection — tool lifecycle event handling.
 *
 * Verifies that tool_event events correctly create and update ToolSteps
 * in the display projection's ThinkBlock.
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

const ts = (n: number) => 1_700_100_000_000 + n

const makeDisplay = async (events: AppEvent[]): Promise<DisplayState> => {
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

  return Effect.runPromise(
    program.pipe(Effect.provide(runtimeLayer)) as Effect.Effect<DisplayState>,
  )
}

const forkId = null
const turnId = 'turn-1'

describe('Display projection — tool lifecycle events', () => {
  it('creates a ToolStep on ToolInputStarted', async () => {
    const toolCallId = 'tc-1' as ToolCallId
    const providerToolCallId = 'tc-1' as ProviderToolCallId

    const state = await makeDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'chain-1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'shell',
        event: { _tag: 'ToolInputStarted', toolCallId, providerToolCallId, toolName: 'shell', toolKey: 'shell' },
      } as AppEvent,
    ])

    const thinkBlock = state.messages.find(m => m.type === 'think_block')
    expect(thinkBlock).toBeDefined()
    if (!thinkBlock || thinkBlock.type !== 'think_block') return

    const toolStep = thinkBlock.steps.find(s => s.id === toolCallId && s.type === 'tool') as ToolStep | undefined
    expect(toolStep).toBeDefined()
    expect(toolStep!.toolKey).toBe('shell')
  })

  it('updates ToolStep state on ToolExecutionEnded', async () => {
    const toolCallId = 'tc-1' as ToolCallId
    const providerToolCallId = 'tc-1' as ProviderToolCallId

    const state = await makeDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'chain-1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'shell',
        event: { _tag: 'ToolInputStarted', toolCallId, providerToolCallId, toolName: 'shell', toolKey: 'shell' },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(3), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'shell',
        event: { _tag: 'ToolInputReady', toolCallId, providerToolCallId },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(4), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'shell',
        event: {
          _tag: 'ToolExecutionStarted', toolCallId, providerToolCallId, toolName: 'shell', toolKey: 'shell',
          input: { command: 'ls' }, cached: false,
        },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(5), forkId, turnId, toolCallId, providerToolCallId, toolKey: 'shell',
        event: {
          _tag: 'ToolExecutionEnded', toolCallId, providerToolCallId, toolName: 'shell', toolKey: 'shell',
          result: { _tag: 'Success', output: 'file1.txt\nfile2.txt' },
        },
      } as AppEvent,
    ])

    const thinkBlock = state.messages.find(m => m.type === 'think_block')
    if (!thinkBlock || thinkBlock.type !== 'think_block') {
      throw new Error('Expected think block')
    }

    const toolStep = thinkBlock.steps.find(s => s.id === toolCallId && s.type === 'tool') as ToolStep | undefined
    expect(toolStep).toBeDefined()
    expect(toolStep!.toolKey).toBe('shell')
  })

  it('multiple tool calls tracked independently', async () => {
    const state = await makeDisplay([
      { type: 'turn_started', timestamp: ts(1), forkId, turnId, chainId: 'chain-1' } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(2), forkId, turnId, toolCallId: 'tc-1', providerToolCallId: 'tc-1' as ProviderToolCallId, toolKey: 'shell',
        event: { _tag: 'ToolInputStarted', toolCallId: 'tc-1' as ToolCallId, providerToolCallId: 'tc-1' as ProviderToolCallId, toolName: 'shell', toolKey: 'shell' },
      } as AppEvent,
      {
        type: 'tool_event', timestamp: ts(3), forkId, turnId, toolCallId: 'tc-2', providerToolCallId: 'tc-2' as ProviderToolCallId, toolKey: 'fileRead',
        event: { _tag: 'ToolInputStarted', toolCallId: 'tc-2' as ToolCallId, providerToolCallId: 'tc-2' as ProviderToolCallId, toolName: 'read', toolKey: 'fileRead' },
      } as AppEvent,
    ])

    const thinkBlock = state.messages.find(m => m.type === 'think_block')
    if (!thinkBlock || thinkBlock.type !== 'think_block') throw new Error('Expected think block')

    const step1 = thinkBlock.steps.find(s => s.id === 'tc-1' && s.type === 'tool') as ToolStep | undefined
    const step2 = thinkBlock.steps.find(s => s.id === 'tc-2' && s.type === 'tool') as ToolStep | undefined

    expect(step1).toBeDefined()
    expect(step1!.toolKey).toBe('shell')
    expect(step2).toBeDefined()
    expect(step2!.toolKey).toBe('fileRead')
  })
})
