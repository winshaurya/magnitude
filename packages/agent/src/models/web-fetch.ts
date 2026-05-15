import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { webFetchTool } from '../tools/web-fetch-tool'

export interface WebFetchState extends BaseState {
  url?: string
  errorDetail?: string
}

const initial: Omit<WebFetchState, 'phase'> = {
  url: undefined,
  errorDetail: undefined,
}

export const webFetchModel = defineStateModel(webFetchTool)<WebFetchState>({
  initial,
  reduce: (state, event): WebFetchState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming', errorDetail: undefined }
      case 'ToolInputFieldChunk':
        return event.field === 'url'
          ? { ...state, phase: 'streaming', url: (state.url ?? '') + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', url: event.input.url ?? state.url }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', url: event.result.output.url }
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
