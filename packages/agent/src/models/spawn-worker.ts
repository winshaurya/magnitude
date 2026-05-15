import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { spawnWorkerTool } from '../tools/task-tools'

export interface SpawnWorkerState extends BaseState {
  taskId?: string
  role?: string
  agentId?: string
  message?: string
  yield?: boolean
  title?: string
}

const initial: Omit<SpawnWorkerState, 'phase'> = {
  taskId: undefined,
  role: undefined,
  agentId: undefined,
  message: undefined,
  yield: undefined,
  title: undefined,
}

export const spawnWorkerModel = defineStateModel(spawnWorkerTool)<SpawnWorkerState>({
  initial,
  reduce: (state, event): SpawnWorkerState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        if (event.field === 'taskId') return { ...state, phase: 'streaming', taskId: (state.taskId ?? '') + event.delta }
        if (event.field === 'agentId') return { ...state, phase: 'streaming', agentId: (state.agentId ?? '') + event.delta }
        if (event.field === 'message') return { ...state, phase: 'streaming', message: (state.message ?? '') + event.delta }
        if (event.field === 'role') return { ...state, phase: 'streaming', role: (state.role ?? '') + event.delta }
        return state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return {
          ...state,
          phase: 'executing',
          taskId: event.input.taskId ?? state.taskId,
          agentId: event.input.agentId ?? state.agentId,
          message: event.input.message ?? state.message,
          role: event.input.role,
        }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', taskId: event.result.output.taskId, agentId: event.result.output.agentId, title: event.result.output.title }
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
