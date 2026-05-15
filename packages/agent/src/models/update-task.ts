import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { updateTaskTool } from '../tools/task-tools'

export interface UpdateTaskState extends BaseState {
  taskId?: string
  status?: 'pending' | 'completed' | 'cancelled'
}

const initial: Omit<UpdateTaskState, 'phase'> = {
  taskId: undefined,
  status: undefined,
}

function isValidUpdateTaskStatus(value: string | undefined): value is NonNullable<UpdateTaskState['status']> {
  return value === 'pending' || value === 'completed' || value === 'cancelled'
}

export const updateTaskModel = defineStateModel(updateTaskTool)<UpdateTaskState>({
  initial,
  reduce: (state, event): UpdateTaskState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        if (event.field === 'taskId') return { ...state, phase: 'streaming', taskId: (state.taskId ?? '') + event.delta }
        return state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return {
          ...state,
          phase: 'executing',
          taskId: event.input.taskId ?? state.taskId,
          status: isValidUpdateTaskStatus(event.input.status) ? event.input.status : state.status,
        }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', taskId: event.result.output.taskId, status: event.result.output.status }
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
