import type { Attachment, CompactionState, DisplayState, RoleProfile } from '@magnitudedev/agent'
import type { RoleId } from '@magnitudedev/roles'
import type { TaskListItem } from './task-list/index'
import type { BashResult } from '../../utils/bash-executor'
import type { KeyEvent } from '@opentui/core'
import type { ChatTheme } from '../../types/theme-system'

export type ChatControllerEnv = {
  status: DisplayState['status']
  pendingApproval: boolean
  hasRunningForks: boolean
  bashMode: boolean
  modelsConfigured: boolean
  modelSummary: { role: string; model: string } | null
  tokenUsage: number | null
  contextHardCap: number | null
  isCompacting: boolean
  theme: ChatTheme
  modeColor: string
  attachmentsMaxWidth: number
  composerCanFocus: boolean
  widgetNavActive: boolean
  isSubagentView: boolean
  supportsVision: boolean
}

export type ChatControllerServices = {
  submitUserMessageToFork: (payload: {
    forkId: string | null
    message: string
    visibleMessage?: string
    mentionAttachments?: Attachment[]
    attachments: Attachment[]
  }) => Promise<void> | void
  runSlashCommand: (commandText: string) => boolean | void
  executeBash: (command: string) => BashResult | Promise<BashResult>
  appendBashOutput: (result: BashResult) => void
  recordBashCommand: (result: BashResult) => void
  clearSystemBanners: () => void
  interruptFork: (forkId: string | null) => void
  interruptAll: () => void
  openSettings: () => void
  handleWidgetKeyEvent: (key: KeyEvent) => boolean
  enterBashMode: () => void
  exitBashMode: () => void
  requestIdleSubagentClose: (payload: { forkId: string; agentId: string }) => void
  requestActiveSubagentKill: (payload: { forkId: string; agentId: string }) => void
  showToast: (message: string) => void
}


export type SubscribeForkCompaction = (forkId: string, cb: (state: CompactionState) => void) => () => void
export type SubscribeForkWindow = (forkId: string, cb: (state: { tokenEstimate: number }) => void) => () => void

export type ChatControllerProps = {
  env: ChatControllerEnv
  services: ChatControllerServices
  displayMessages: DisplayState['messages']
  tasks: TaskListItem[]
  selectedForkId: string | null
  pushForkOverlay: (forkId: string) => void
  roleProfiles: Partial<Record<RoleId, RoleProfile>> | null
  subscribeForkCompaction: SubscribeForkCompaction
  subscribeForkWindow: SubscribeForkWindow
  isBlockingOverlayActive: boolean
  selectedFileOpen: boolean
  onCloseFilePanel: () => void
  onApprove: () => void
  onReject: () => void
  onInputHasTextChange?: (hasText: boolean) => void
  restoredQueuedInputText?: string | null
  onRestoredQueuedInputHandled?: () => void
}