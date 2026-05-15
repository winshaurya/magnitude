import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { grepTool } from '../tools/fs'

type SearchMatch = { file: string; match: string }

export interface FileSearchState extends BaseState {
  pattern?: string
  path?: string
  glob?: string
  limit?: number
  matches: SearchMatch[]
  matchCount: number
  fileCount: number
  errorDetail?: string
}

const initial: Omit<FileSearchState, 'phase'> = {
  pattern: undefined,
  path: undefined,
  glob: undefined,
  limit: undefined,
  matches: [],
  matchCount: 0,
  fileCount: 0,
  errorDetail: undefined,
}

export const fileSearchModel = defineStateModel(grepTool)<FileSearchState>({
  initial,
  reduce: (state, event): FileSearchState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming' }
      case 'ToolInputFieldChunk':
        if (event.field === 'pattern') return { ...state, phase: 'streaming', pattern: (state.pattern ?? '') + event.delta }
        if (event.field === 'path') return { ...state, phase: 'streaming', path: (state.path ?? '') + event.delta }
        if (event.field === 'glob') return { ...state, phase: 'streaming', glob: (state.glob ?? '') + event.delta }
        return state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return {
          ...state,
          phase: 'executing',
          pattern: event.input.pattern ?? state.pattern,
          path: event.input.path ?? state.path,
          glob: event.input.glob ?? state.glob,
          limit: event.input.limit ?? state.limit,
        }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success': {
            const matches = [...event.result.output]
            return {
              ...state,
              phase: 'completed',
              matches,
              matchCount: matches.length,
              fileCount: new Set(matches.map((m) => m.file)).size,
            }
          }
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
