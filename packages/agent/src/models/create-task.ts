import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { createTaskTool } from '../tools/task-tools'

export interface CreateTaskState extends BaseState {
  taskId?: string
}

const initial: Omit<CreateTaskState, 'phase'> = {
  taskId: undefined,
}

export const createTaskModel = defineStateModel(createTaskTool)<CreateTaskState>({
  initial,
  reduce: (state, event): CreateTaskState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        return event.field === 'taskId'
          ? { ...state, phase: 'streaming', taskId: (state.taskId ?? '') + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', taskId: event.input.taskId ?? state.taskId }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', taskId: event.result.output.taskId }
          case 'Error':
            return { ...state, phase: 'error' }
          case 'Denied':
            return { ...state, phase: 'rejected', errorMessage: String(event.result.denial) }
          case 'Interrupted':
            return { ...state, phase: 'interrupted' }
          default:
            return state
        }
      }
      case 'ToolInputRejected':
        return { ...state, phase: 'error', errorMessage: event.issue.message }
      case 'ToolEmission':
      case 'ToolInputFieldComplete':
      default:
        return state
    }
  },
})
