import { RecentChatsOverlay } from './recent-chats-overlay'
import { ForkDetailOverlay } from './fork-detail-overlay'
import { SettingsOverlay } from './settings-overlay'
import { UsageOverlay } from './usage-overlay'
import type { AgentStatusState, ActionId } from '@magnitudedev/agent'
import type { RecentChat } from '../data/recent-chats'
import type { MagnitudeAuthState } from '../hooks/use-magnitude-auth'
import { createCodingAgentClient } from '@magnitudedev/agent'
import { useTheme } from '../hooks/use-theme'
import { BOX_CHARS } from '../utils/ui-constants'

type AgentClient = Awaited<ReturnType<typeof createCodingAgentClient>>

export type AppOverlaysProps = {
  settingsVisible: boolean
  onSettingsClose: () => void
  auth: MagnitudeAuthState
  roles: ReadonlyArray<{
    id: string
    description: string
    modelDisplayName: string | null
  }>

  showRecentChatsOverlay: boolean
  recentChats: RecentChat[] | null
  recentChatsSelectedIndex: number
  setRecentChatsSelectedIndex: (n: number) => void
  setShowRecentChatsOverlay: (v: boolean | ((prev: boolean) => boolean)) => void
  handleResumeChat: (chat: RecentChat) => void

  expandedForkId: string | null
  client: AgentClient | null
  agentStatusState: AgentStatusState | null
  forkModelSummary: { role: string; model: string } | null
  forkContextHardCap: number | null
  popForkOverlay: () => void
  pushForkOverlay: (forkId: string) => void
  scratchpadPath: string | null
  projectRoot: string
  showCopiedToast: boolean

  usageVisible: boolean
  onUsageClose: () => void

  onErrorAction?: (actionId: ActionId) => void
}

export function AppOverlays({
  settingsVisible,
  onSettingsClose,
  auth,
  roles,
  showRecentChatsOverlay,
  recentChats,
  recentChatsSelectedIndex,
  setRecentChatsSelectedIndex,
  setShowRecentChatsOverlay,
  handleResumeChat,
  expandedForkId,
  client,
  agentStatusState,
  forkModelSummary,
  forkContextHardCap,
  popForkOverlay,
  pushForkOverlay,
  scratchpadPath,
  projectRoot,
  showCopiedToast,
  usageVisible,
  onUsageClose,
  onErrorAction,
}: AppOverlaysProps) {
  const theme = useTheme()

  if (showRecentChatsOverlay) {
    return (
      <box style={{ flexDirection: 'column', height: '100%' }}>
        <RecentChatsOverlay
          chats={recentChats ?? []}
          selectedIndex={recentChatsSelectedIndex}
          onSelectedIndexChange={setRecentChatsSelectedIndex}
          onSelect={handleResumeChat}
          onHoverIndex={setRecentChatsSelectedIndex}
          onClose={() => setShowRecentChatsOverlay(false)}
        />
      </box>
    )
  }

  if (expandedForkId && client) {
    const agentId = agentStatusState?.agentByForkId.get(expandedForkId)
    const agent = agentId ? agentStatusState?.agents.get(agentId) : undefined
    return (
      <box style={{ flexDirection: 'column', height: '100%', position: 'relative' }}>
        <ForkDetailOverlay
          forkId={expandedForkId}
          forkName={agent?.name ?? 'Agent'}
          forkRole={agent?.role ?? 'agent'}
          onClose={popForkOverlay}
          onForkExpand={pushForkOverlay}
          onErrorAction={onErrorAction}
          modelSummary={forkModelSummary}
          contextHardCap={forkContextHardCap}
          scratchpadPath={scratchpadPath}
          projectRoot={projectRoot}
          subscribeForkDisplay={(fId, cb) => client.state.display.subscribeFork(fId, cb)}
          subscribeForkCompaction={(fId, cb) => client.state.compaction.subscribeFork(fId, cb)}
          subscribeForkWindow={(fId, cb) => client.state.memory.subscribeFork(fId, cb)}
          subscribeForkHarnessState={(fId, cb) => client.state.harnessState.subscribeFork(fId, cb)}
        />

        {showCopiedToast && (
          <box style={{ position: 'absolute', bottom: 1, right: 2 }}>
            <box style={{
              borderStyle: 'single',
              border: ['left'],
              borderColor: theme.success,
              customBorderChars: { ...BOX_CHARS, vertical: '┃' },
            }}>
              <box style={{
                backgroundColor: theme.surface,
                paddingTop: 1,
                paddingBottom: 1,
                paddingLeft: 2,
                paddingRight: 2,
              }}>
                <text style={{ fg: theme.success }}>Copied to clipboard</text>
              </box>
            </box>
          </box>
        )}
      </box>
    )
  }

  if (settingsVisible) {
    return (
      <box style={{ flexDirection: 'column', height: '100%' }}>
        <SettingsOverlay
          isVisible={settingsVisible}
          onClose={onSettingsClose}
          auth={auth}
          roles={roles}
        />
      </box>
    )
  }

  if (usageVisible) {
    return (
      <box style={{ flexDirection: 'column', height: '100%' }}>
        <UsageOverlay
          isVisible={usageVisible}
          onClose={onUsageClose}
          apiKey={auth.key}
        />
      </box>
    )
  }

  return null
}