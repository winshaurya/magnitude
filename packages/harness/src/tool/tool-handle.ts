import type { ProviderToolCallId, ToolCallId } from "@magnitudedev/ai"
import type { HarnessEvent, ToolLifecycleEvent, ToolExecutionEnded } from "../events"
import type { BaseState, StateModel } from "./state-model"

export interface ToolHandle {
  readonly toolCallId: ToolCallId
  readonly providerToolCallId: ProviderToolCallId
  readonly toolKey: string
  readonly state: BaseState
  readonly process: (event: HarnessEvent) => ToolHandle
  readonly interrupt: () => ToolHandle
}

export function createToolHandle(
  toolCallId: ToolCallId,
  providerToolCallId: ProviderToolCallId,
  toolKey: string,
  model: StateModel,
): ToolHandle {
  return buildHandle(toolCallId, providerToolCallId, toolKey, model.initial, model.reduce)
}

function isToolLifecycleEvent(event: HarnessEvent): event is ToolLifecycleEvent {
  switch (event._tag) {
    case 'ToolInputStarted':
    case 'ToolInputFieldChunk':
    case 'ToolInputFieldComplete':
    case 'ToolInputReady':
    case 'ToolInputRejected':
    case 'ToolExecutionStarted':
    case 'ToolExecutionEnded':
    case 'ToolEmission':
      return true
    default:
      return false
  }
}

function buildHandle(
  toolCallId: ToolCallId,
  providerToolCallId: ProviderToolCallId,
  toolKey: string,
  state: BaseState,
  reduce: (state: BaseState, event: ToolLifecycleEvent) => BaseState,
): ToolHandle {
  return {
    toolCallId,
    providerToolCallId,
    toolKey,
    get state() { return state },
    process(event: HarnessEvent): ToolHandle {
      if (!isToolLifecycleEvent(event)) return this
      const reduced = reduce(state, event)
      return buildHandle(toolCallId, providerToolCallId, toolKey, reduced, reduce)
    },
    interrupt(): ToolHandle {
      const interruptEvent: ToolLifecycleEvent = {
        _tag: 'ToolExecutionEnded',
        toolCallId,
        providerToolCallId,
        toolName: '',
        toolKey,
        result: { _tag: 'Interrupted' },
      } satisfies ToolExecutionEnded
      return buildHandle(toolCallId, providerToolCallId, toolKey, reduce(state, interruptEvent), reduce)
    },
  }
}
