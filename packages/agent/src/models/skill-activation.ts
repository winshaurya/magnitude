import { defineStateModel, type BaseState } from '@magnitudedev/harness'
import { skillTool } from '../tools/skill-tool'

export interface SkillActivationState extends BaseState {
  skillName?: string
  skillPath?: string
  contentPreview?: string
  errorDetail?: string
}

const initial: Omit<SkillActivationState, 'phase'> = {
  skillName: undefined,
  skillPath: undefined,
  contentPreview: undefined,
  errorDetail: undefined,
}

export const skillActivationModel = defineStateModel(skillTool)<SkillActivationState>({
  initial,
  reduce: (state, event): SkillActivationState => {
    switch (event._tag) {
      case 'ToolInputStarted':
        return { ...state, phase: 'streaming', errorDetail: undefined }
      case 'ToolInputFieldChunk':
        return event.field === 'name'
          ? { ...state, phase: 'streaming', skillName: (state.skillName ?? '') + event.delta }
          : state
      case 'ToolInputReady':
        return state
      case 'ToolExecutionStarted':
        return { ...state, phase: 'executing', skillName: event.input.name ?? state.skillName }
      case 'ToolExecutionEnded': {
        switch (event.result._tag) {
          case 'Success': {
            const output = event.result.output
            const content = output.content
            return {
              ...state,
              phase: 'completed',
              skillPath: output.skillPath ?? state.skillPath,
              contentPreview: content.length > 200 ? content.slice(0, 200) + '…' : content,
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
