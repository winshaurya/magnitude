import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { webSearchTool } from '../tools/web-search'

export interface WebSearchState extends BaseState {
  query?: string
  sources?: readonly { title: string; url: string }[]
  errorDetail?: string
}

const initial: Omit<WebSearchState, 'phase'> = {
  query: undefined,
  sources: undefined,
  errorDetail: undefined,
}

export const webSearchModel = defineStateModel(webSearchTool)<WebSearchState>({
  initial,
  reduce: (state, event): WebSearchState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming', errorDetail: undefined }
      case 'ToolInputFieldChunk':
        return event.field === 'query'
          ? { ...state, phase: 'streaming', query: (state.query ?? '') + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', query: event.input.query ?? state.query }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return { ...state, phase: 'completed', sources: event.result.output.sources ?? [] }
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
