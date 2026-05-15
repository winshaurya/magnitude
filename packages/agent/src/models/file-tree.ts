import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { treeTool } from '../tools/fs'

type TreeEntry = { path: string; name: string; type: 'file' | 'dir'; depth: number }

export interface FileTreeState extends BaseState {
  path?: string
  entries: TreeEntry[]
  fileCount: number
  dirCount: number
  errorDetail?: string
}

const initial: Omit<FileTreeState, 'phase'> = {
  path: undefined,
  entries: [],
  fileCount: 0,
  dirCount: 0,
  errorDetail: undefined,
}

export const fileTreeModel = defineStateModel(treeTool)<FileTreeState>({
  initial,
  reduce: (state, event): FileTreeState => {
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
          case 'Success': {
            const entries = event.result.output
            return {
              ...state,
              phase: 'completed',
              entries: [...entries],
              fileCount: entries.filter((e) => e.type === 'file').length,
              dirCount: entries.filter((e) => e.type === 'dir').length,
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
