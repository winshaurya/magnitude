import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { reassignWorkerTool } from '../tools/task-tools'

export interface ReassignWorkerState extends BaseState {
  agentId?: string
  taskId?: string
}

const initial: Omit<ReassignWorkerState, 'phase'> = {
  agentId: undefined,
  taskId: undefined,
}

export const reassignWorkerModel = defineStateModel(reassignWorkerTool)<ReassignWorkerState>({
  initial,
  reduce: (state, event): ReassignWorkerState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        if (event.field === 'agentId') return { ...state, phase: 'streaming', agentId: (state.agentId ?? '') + event.delta }
        if (event.field === 'taskId') return { ...state, phase: 'streaming', taskId: (state.taskId ?? '') + event.delta }
        return state
      case 'ToolExecutionStarted':
        return {
          ...state,
          phase: 'executing',
          agentId: event.input.agentId ?? state.agentId,
          taskId: event.input.taskId ?? state.taskId,
        }
      case 'ToolExecutionEnded':
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', agentId: event.result.output.agentId, taskId: event.result.output.taskId }
          case 'Error':
            return { ...state, phase: 'error' }
          case 'Denied':
            return { ...state, phase: 'rejected', errorMessage: String(event.result.denial) }
          case 'Interrupted':
            return { ...state, phase: 'interrupted' }
          default:
            return state
        }
      case 'ToolInputRejected':
        return { ...state, phase: 'error', errorMessage: event.issue.message }
      default:
        return state
    }
  },
})
