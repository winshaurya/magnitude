import type { ToolKey } from '@magnitudedev/agent'
import type { BaseState } from '@magnitudedev/harness'
import type { CommonToolProps, ToolDisplay } from './types'
import { shellDisplay } from './displays/shell'
import { diffDisplay } from './displays/diff'
import { contentDisplay } from './displays/content'
import { fileReadDisplay } from './displays/file-read'
import { fileSearchDisplay } from './displays/file-search'
import { fileTreeDisplay } from './displays/file-tree'
import { webSearchDisplay } from './displays/web-search'
import { webFetchDisplay } from './displays/web-fetch'
import { skillDisplay } from './displays/skill'
import { defaultDisplay } from './displays/default'
import { spawnWorkerDisplay } from './displays/spawn-worker'
import { reassignWorkerDisplay } from './displays/reassign-worker'

/**
 * Erases the specific state type from a ToolDisplay, allowing it to accept BaseState.
 * This is safe because the dispatch function (renderToolStep/summarizeToolStep) guarantees
 * that the correct display is matched to the correct state shape via toolKey.
 */
/**
 * Wraps a typed ToolDisplay to accept BaseState.
 * Safe because the toolKey-based dispatch guarantees the correct state shape.
 */
function eraseStateType<T extends BaseState>(display: ToolDisplay<T>): ToolDisplay<BaseState> {
  return {
    render: (props) => display.render({ ...props, state: props.state as T }),
    summary: (state) => display.summary(state as T),
  }
}

const displaysByToolKey: Partial<Record<string, ToolDisplay<BaseState>>> = {
  shell: eraseStateType(shellDisplay),
  fileRead: eraseStateType(fileReadDisplay),
  fileWrite: eraseStateType(contentDisplay),
  fileEdit: eraseStateType(diffDisplay),
  fileTree: eraseStateType(fileTreeDisplay),
  fileSearch: eraseStateType(fileSearchDisplay),
  webSearch: eraseStateType(webSearchDisplay),
  webFetch: eraseStateType(webFetchDisplay),
  skill: eraseStateType(skillDisplay),
  spawnWorker: eraseStateType(spawnWorkerDisplay),
  reassignWorker: eraseStateType(reassignWorkerDisplay),
}

const fallback = eraseStateType(defaultDisplay)

function getDisplay(toolKey: ToolKey): ToolDisplay<BaseState> {
  return displaysByToolKey[toolKey] ?? fallback
}

export function renderToolStep(toolKey: ToolKey, state: BaseState, common: CommonToolProps) {
  return getDisplay(toolKey).render({ state, ...common })
}

export function summarizeToolStep(toolKey: ToolKey, state: BaseState): string {
  return getDisplay(toolKey).summary(state)
}
