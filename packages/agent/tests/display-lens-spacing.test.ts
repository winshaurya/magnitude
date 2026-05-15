import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestHarness, TestHarnessLive } from '../src/test-harness/harness'
import { DisplayProjection } from '../src/projections/display'

const ts = (n: number) => 1_700_000_000_000 + n

describe('display lens spacing', () => {
  it.live('should keep all thinking content in one thinking step without extra spaces', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      yield* h.send({
        type: 'turn_started',
        timestamp: ts(1),
        forkId: null,
        turnId: 'turn-1',
        chainId: 'chain-1',
      } as any)

      yield* h.send({
        type: 'thinking_start',
        timestamp: ts(2),
        forkId: null,
        turnId: 'turn-1',
      } as any)

      yield* h.send({
        type: 'thinking_chunk',
        timestamp: ts(3),
        forkId: null,
        turnId: 'turn-1',
        text: 'First lens content',
      } as any)

      yield* h.send({
        type: 'thinking_chunk',
        timestamp: ts(4),
        forkId: null,
        turnId: 'turn-1',
        text: '\nSecond lens content',
      } as any)

      const display = yield* h.projectionFork(DisplayProjection.Tag, null)
      
      const thinkBlock = display.messages.find(m => m.type === 'think_block')
      expect(thinkBlock).toBeDefined()
      expect(thinkBlock?.type).toBe('think_block')
      
      if (thinkBlock && thinkBlock.type === 'think_block') {
        const thinkingSteps = thinkBlock.steps.filter(s => s.type === 'thinking')
        expect(thinkingSteps.length).toBe(1)
        
        expect(thinkingSteps[0].content).toBe('First lens content\nSecond lens content')
      }
    }).pipe(Effect.provide(TestHarnessLive({ workers: { cortex: false } })))
  )

  it.live('should not add space between thinking chunks', () =>
    Effect.gen(function* () {
      const h = yield* TestHarness

      yield* h.send({
        type: 'turn_started',
        timestamp: ts(1),
        forkId: null,
        turnId: 'turn-1',
        chainId: 'chain-1',
      } as any)

      yield* h.send({
        type: 'thinking_start',
        timestamp: ts(2),
        forkId: null,
        turnId: 'turn-1',
      } as any)

      yield* h.send({
        type: 'thinking_chunk',
        timestamp: ts(3),
        forkId: null,
        turnId: 'turn-1',
        text: 'Alignment reasoning',
      } as any)

      yield* h.send({
        type: 'thinking_chunk',
        timestamp: ts(4),
        forkId: null,
        turnId: 'turn-1',
        text: '\nTasks reasoning',
      } as any)

      const display = yield* h.projectionFork(DisplayProjection.Tag, null)
      const thinkBlock = display.messages.find(m => m.type === 'think_block')
      
      if (thinkBlock && thinkBlock.type === 'think_block') {
        const thinkingSteps = thinkBlock.steps.filter(s => s.type === 'thinking')
        expect(thinkingSteps.length).toBe(1)
        expect(thinkingSteps[0].content).toBe('Alignment reasoning\nTasks reasoning')
      }
    }).pipe(Effect.provide(TestHarnessLive({ workers: { cortex: false } })))
  )
})
