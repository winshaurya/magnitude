/**
 * Per-role toolkit composition.
 *
 * Replaces catalog.ts as the source of tool→state pairings.
 * Each toolkit entry pairs a HarnessTool with its StateModel using the same
 * keys that catalog.ts used (e.g., 'fileRead', 'shell', 'webSearch').
 */

import { defineToolkit, mergeToolkits, type Toolkit, type ToolkitKeys } from '@magnitudedev/harness'
import type { RoleId } from '../agents/role-validation'
import type { ConfigState } from '../ambient/config-ambient'

// --- Tools ---
import { readTool, writeTool, editTool, treeTool, grepTool, viewTool } from './fs'
import { shellTool } from './shell'
import { webSearchTool } from './web-search'
import { webFetchTool } from './web-fetch-tool'
import { createTaskTool, updateTaskTool, spawnWorkerTool, killWorkerTool, reassignWorkerTool } from './task-tools'
import { skillTool } from './skill-tool'
import { messageWorkerTool } from './agent-communication'

// --- State Models ---
import { fileReadModel } from '../models/file-read'
import { fileWriteModel } from '../models/file-write'
import { fileEditModel } from '../models/file-edit'
import { fileTreeModel } from '../models/file-tree'
import { fileSearchModel } from '../models/file-search'
import { fileViewModel } from '../models/file-view'
import { shellModel } from '../models/shell'
import { webSearchModel } from '../models/web-search'
import { webFetchModel } from '../models/web-fetch'
import { createTaskModel } from '../models/create-task'
import { updateTaskModel } from '../models/update-task'
import { spawnWorkerModel } from '../models/spawn-worker'
import { killWorkerModel } from '../models/kill-worker'
import { reassignWorkerModel } from '../models/reassign-worker'
import { skillActivationModel } from '../models/skill-activation'
import { messageWorkerModel } from '../models/message-worker'
import { compactTool } from './compact'
import { compactModel } from '../models/compact'

// =============================================================================
// Group Toolkits
// =============================================================================

export const fsToolkit = defineToolkit({
  fileRead:   { tool: readTool,   state: fileReadModel },
  fileWrite:  { tool: writeTool,  state: fileWriteModel },
  fileEdit:   { tool: editTool,   state: fileEditModel },
  fileTree:   { tool: treeTool,   state: fileTreeModel },
  fileSearch: { tool: grepTool,   state: fileSearchModel },
  fileView:   { tool: viewTool,   state: fileViewModel },
})

export const shellToolkit = defineToolkit({
  shell: { tool: shellTool, state: shellModel },
})

export const webToolkit = defineToolkit({
  webSearch: { tool: webSearchTool, state: webSearchModel },
  webFetch:  { tool: webFetchTool,  state: webFetchModel },
})

export const taskToolkit = defineToolkit({
  createTask:      { tool: createTaskTool,      state: createTaskModel },
  updateTask:      { tool: updateTaskTool,      state: updateTaskModel },
  spawnWorker:     { tool: spawnWorkerTool,     state: spawnWorkerModel },
  killWorker:      { tool: killWorkerTool,      state: killWorkerModel },
  reassignWorker:  { tool: reassignWorkerTool,  state: reassignWorkerModel },
  messageWorker:   { tool: messageWorkerTool,  state: messageWorkerModel },
})

export const skillToolkit = defineToolkit({
  skill: { tool: skillTool, state: skillActivationModel },
})

export const compactToolkit = defineToolkit({
  compact: { tool: compactTool, state: compactModel },
})

// =============================================================================
// Composite Toolkits
// =============================================================================

/** fs + shell + web + skill + compact — shared by most worker roles */
const workerBase = mergeToolkits(
  mergeToolkits(fsToolkit, shellToolkit),
  mergeToolkits(webToolkit, mergeToolkits(skillToolkit, compactToolkit)),
)

/** fs + shell + skill + compact — no web access */
const criticBase = mergeToolkits(
  mergeToolkits(fsToolkit, shellToolkit),
  mergeToolkits(skillToolkit, compactToolkit),
)

/** fs + shell + web + task + skill — full leader toolkit */
export const leaderToolkit = mergeToolkits(
  workerBase,
  taskToolkit,
)

// =============================================================================
// Role → Toolkit mapping
// =============================================================================

const emptyToolkit = defineToolkit({})

const ROLE_TOOLKITS: Record<RoleId, Toolkit> = {
  leader:    leaderToolkit,
  engineer:  workerBase,
  artisan:   workerBase,
  scientist: workerBase,
  scout:     workerBase,
  architect: workerBase,
  critic:    criticBase,
  advisor:   compactToolkit,
}

// =============================================================================
// ToolKey — derived from the leader toolkit (superset of all role toolkits)
// =============================================================================

/** Tools that should not be displayed in the UI */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set(['createTask', 'updateTask', 'killWorker', 'reassignWorker', 'messageWorker', 'compact'])

export type ToolKey = ToolkitKeys<typeof leaderToolkit>

export function isToolKey(value: string): value is ToolKey {
  return value in leaderToolkit.entries
}

/**
 * Get the static toolkit for a given role.
 * Returns a Toolkit with entries keyed by the canonical tool keys
 * (fileRead, shell, webSearch, etc.).
 */
export function getToolkitForRole(roleId: RoleId): Toolkit {
  return ROLE_TOOLKITS[roleId]
}

/**
 * Get the effective toolkit for a role, with runtime availability filtering applied.
 *
 * Currently filters:
 * - `webSearch`: removed when the role's provider is not `magnitude` and `EXA_API_KEY` is absent
 */
export function getEffectiveToolkit(roleId: RoleId, configState: ConfigState): Toolkit {
  const toolkit = getToolkitForRole(roleId)

  // webSearch is only available via Magnitude provider or with an EXA API key
  const hasWebSearch = 'webSearch' in toolkit.entries
  if (hasWebSearch) {
    const roleConfig = configState.byRole[roleId]
    const isMagnitudeProvider = roleConfig.modelId.startsWith('role/')
    const hasExaKey = !!process.env.EXA_API_KEY
    if (!isMagnitudeProvider && !hasExaKey) {
      return toolkit.omit('webSearch')
    }
  }

  return toolkit
}
