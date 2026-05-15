import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { readTool } from '../tools/fs'

export interface FileReadState extends BaseState {
  path?: string
  lineCount?: number
  errorDetail?: string
}

const initial: Omit<FileReadState, 'phase'> = {
  path: undefined,
  lineCount: undefined,
  errorDetail: undefined,
}

export const fileReadModel = defineStateModel(readTool)<FileReadState>({
  initial,
  reduce: (state, event): FileReadState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming', errorDetail: undefined }
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
            return { ...state, phase: 'completed', lineCount: event.result.output.split('\n').length }
          case 'Error':
            return { ...state, phase: 'error', errorDetail: event.result.error.message }
          case 'Denied':
            return { ...state, phase: 'rejected' }
          case 'Interrupted':
            return { ...state, phase: 'interrupted' }
          default:
            return state
        }
      }
      case 'ToolInputRejected':
        return { ...state, phase: 'error', errorDetail: event.issue.message }
      case 'ToolEmission':
      case 'ToolInputFieldComplete':
      default:
        return state
    }
  },
})
