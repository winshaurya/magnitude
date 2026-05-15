import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { viewTool } from '../tools/fs'

export interface FileViewState extends BaseState {
  path?: string
}

const initial: Omit<FileViewState, 'phase'> = {
  path: undefined,
}

export const fileViewModel = defineStateModel(viewTool)<FileViewState>({
  initial,
  reduce: (state, event): FileViewState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        return event.field === 'path'
          ? { ...state, phase: 'streaming', path: (state.path ?? '') + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', path: event.input.path ?? state.path }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed' }
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
