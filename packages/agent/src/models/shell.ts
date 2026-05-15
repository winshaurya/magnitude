import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { shellTool } from '../tools/shell'

export interface ShellState extends BaseState {
  command: string
  done: 'completed' | null
  exitCode?: number
  stdout?: string
  stderr?: string
  errorMessage?: string
}

const initial: Omit<ShellState, 'phase'> = {
  command: '',
  done: null,
  exitCode: undefined,
  stdout: undefined,
  stderr: undefined,
  errorMessage: undefined,
}

export const shellModel = defineStateModel(shellTool)<ShellState>({
  initial,
  reduce: (state, event): ShellState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming', done: null }
      case 'ToolInputFieldChunk':
        return event.field === 'command'
          ? { ...state, command: state.command + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', command: event.input.command ?? state.command }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success':
            return {
              ...state,
              phase: 'completed',
              done: 'completed',
              exitCode: event.result.output.exitCode,
              stdout: event.result.output.stdout,
              stderr: event.result.output.stderr,
              errorMessage: undefined,
            }
          case 'Error':
            return { ...state, phase: 'error', errorMessage: event.result.error.message }
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
