import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { compactTool } from '../tools/compact'

export interface CompactState extends BaseState {
  readonly errorMessage?: string
}

export const compactModel = defineStateModel(compactTool)<CompactState>({
  initial: {},
  reduce: (state, event) => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' as const }
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing' as const }
      case 'ToolExecutionEnded':
        switch (event.result._tag) {
          case 'Success': return { ...state, phase: 'completed' as const }
          case 'Error': return { ...state, phase: 'error' as const, errorMessage: event.result.error.message }
          case 'Denied': return { ...state, phase: 'rejected' as const, errorMessage: String(event.result.denial) }
          case 'Interrupted': return { ...state, phase: 'interrupted' as const }
          default: return { ...state, phase: 'error' as const }
        }
      case 'ToolInputRejected':
        return { ...state, phase: 'error' as const, errorMessage: event.issue.message }
      default:
        return state
    }
  },
})
