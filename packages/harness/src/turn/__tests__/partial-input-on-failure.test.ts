import { describe, it } from '@effect/vitest'
import { expect } from 'vitest'
import { CanonicalAccumulatorReducer, projectCanonical } from '../reducers'
import type { HarnessEvent, ToolInputStarted, ToolInputFieldChunk, ToolInputRejected } from '../../events'
import type { ProviderToolCallId, ToolCallId, StreamingPartial } from '@magnitudedev/ai'
import type { Schema } from 'effect'

// ── Helpers ─────────────────────────────────────────────────────────

function toolInputStarted(id: string, name: string): ToolInputStarted {
  return {
    _tag: 'ToolInputStarted',
    toolCallId: id as ToolCallId,
    providerToolCallId: id as ProviderToolCallId,
    toolName: name,
    toolKey: name,
  }
}

function toolInputFieldChunk(id: string, path: string[], delta: string): ToolInputFieldChunk {
  return {
    _tag: 'ToolInputFieldChunk',
    toolCallId: id as ToolCallId,
    providerToolCallId: id as ProviderToolCallId,
    field: path[path.length - 1],
    path,
    delta,
  }
}

function toolInputRejected(id: string, name: string, message: string): ToolInputRejected {
  return {
    _tag: 'ToolInputRejected',
    toolCallId: id as ToolCallId,
    providerToolCallId: id as ProviderToolCallId,
    toolName: name,
    toolKey: name,
    issue: { path: [], message },
  }
}

function turnEnd(outcome: HarnessEvent extends { _tag: infer T; outcome: infer O } ? O : never): HarnessEvent {
  return {
    _tag: 'TurnEnd',
    outcome,
    usage: null,
  } as HarnessEvent
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('partial input assembly and ToolResultEntry on failure outcomes', () => {
  it('assembles partial inputs into assistantMessage.toolCalls on ToolInputDecodeFailure and produces InputRejected result', () => {
    const reducer = CanonicalAccumulatorReducer
    let state = reducer.initial

    // Stream a tool call with partial input: only "path" is received
    state = reducer.step(state, toolInputStarted('call-1', 'file_edit'))
    state = reducer.step(state, toolInputFieldChunk('call-1', ['path'], '/some/invalid/path'))

    // Decode failure event — reducer produces ToolResultEntry with InputRejected result
    state = reducer.step(state, toolInputRejected('call-1', 'file_edit', 'bad input'))

    // Turn ends with decode failure
    state = reducer.step(state, turnEnd({
      _tag: 'ToolInputDecodeFailure',
      toolCallId: 'call-1' as ToolCallId,
      providerToolCallId: 'call-1' as ProviderToolCallId,
      toolName: 'file_edit',
      issue: { path: [], message: 'bad input' },
      inputSchema: {} as Schema.Schema.AnyNoContext,
      receivedInput: {} as StreamingPartial<Record<string, unknown>>,
    }))

    const canonical = projectCanonical(state)

    // Partial input assembled into assistantMessage.toolCalls
    const toolCall = canonical.assistantMessage.toolCalls?.[0]
    expect(toolCall).toBeDefined()
    expect(toolCall!.name).toBe('file_edit')
    expect(toolCall!.input).toEqual({ path: '/some/invalid/path' })

    // ToolResultEntry with InputRejected result
    const toolResult = canonical.toolResults[0]
    expect(toolResult).toBeDefined()
    expect(toolResult!.toolName).toBe('file_edit')
    expect(toolResult!.result._tag).toBe('InputRejected')
    if (toolResult!.result._tag === 'InputRejected') {
      expect(toolResult!.result.issue).toEqual({ path: [], message: 'bad input' })
      expect(toolResult!.result.partialInput).toEqual({ path: '/some/invalid/path' })
    }
  })

  it('assembles partial inputs into assistantMessage.toolCalls on ToolInputValidationFailure and produces InputRejected result', () => {
    const reducer = CanonicalAccumulatorReducer
    let state = reducer.initial

    // Stream a tool call with partial input: "path" is received but fails validation
    state = reducer.step(state, toolInputStarted('call-1', 'file_edit'))
    state = reducer.step(state, toolInputFieldChunk('call-1', ['path'], '/some/invalid/path'))

    // Validation failure event — reducer produces ToolResultEntry with InputRejected result
    state = reducer.step(state, toolInputRejected('call-1', 'file_edit', 'Path does not exist: /some/invalid/path'))

    // Turn ends with validation failure
    state = reducer.step(state, turnEnd({
      _tag: 'ToolInputValidationFailure',
      toolCallId: 'call-1' as ToolCallId,
      providerToolCallId: 'call-1' as ProviderToolCallId,
      toolName: 'file_edit',
      toolKey: 'file_edit',
      issue: { path: [], message: 'Path does not exist: /some/invalid/path' },
    }))

    const canonical = projectCanonical(state)

    // Partial input assembled into assistantMessage.toolCalls
    const toolCall = canonical.assistantMessage.toolCalls?.[0]
    expect(toolCall).toBeDefined()
    expect(toolCall!.name).toBe('file_edit')
    expect(toolCall!.input).toEqual({ path: '/some/invalid/path' })

    // ToolResultEntry with InputRejected result
    const toolResult = canonical.toolResults[0]
    expect(toolResult).toBeDefined()
    expect(toolResult!.toolName).toBe('file_edit')
    expect(toolResult!.result._tag).toBe('InputRejected')
    if (toolResult!.result._tag === 'InputRejected') {
      expect(toolResult!.result.issue).toEqual({ path: [], message: 'Path does not exist: /some/invalid/path' })
      expect(toolResult!.result.partialInput).toEqual({ path: '/some/invalid/path' })
    }
  })

  it('adds synthetic Interrupted result for tool calls that never completed', () => {
    const reducer = CanonicalAccumulatorReducer
    let state = reducer.initial

    // Stream a tool call — but no ToolExecutionEnded or failure event
    state = reducer.step(state, toolInputStarted('call-1', 'file_edit'))
    state = reducer.step(state, toolInputFieldChunk('call-1', ['path'], '/some/path'))

    // Turn is interrupted — no result event for this tool call
    state = reducer.step(state, turnEnd({ _tag: 'Interrupted' }))

    const canonical = projectCanonical(state)

    // Partial input assembled
    const toolCall = canonical.assistantMessage.toolCalls?.[0]
    expect(toolCall!.input).toEqual({ path: '/some/path' })

    // Synthetic ToolResultEntry added
    const toolResult = canonical.toolResults[0]
    expect(toolResult).toBeDefined()
    expect(toolResult!.result._tag).toBe('Interrupted')
  })
})
