import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useKeyboard, useRenderer } from '@opentui/react'
import { Layer, Cause } from 'effect'

import { createCodingAgentClient, ChatPersistence, getSessionTitleFromTaskGraph, fetchRoleProfiles, classifyUnknownError, present, type DisplayState, type AgentStatusState, type AppEvent, type ErrorDisplayMessage, type CompactionState, type TurnState, type DebugSnapshot, type RoleProfile, type ActionId } from '@magnitudedev/agent'
import { matchKeyToChord } from './utils/chord'
import { loadSkills } from '@magnitudedev/skills'
import { textParts } from '@magnitudedev/agent'
import { JsonChatPersistence, loadSessionSummary } from './persistence'

import { MessageView } from './components/message-view'
import { ErrorBoundary } from './components/error-boundary'
import { StickyWorkingHeader } from './components/think-block'
import { PendingCommunicationsPanel } from './components/pending-communications-panel'
import { LoadPreviousButton } from './components/chat-controls'


import { usePaginatedTimeline } from './hooks/use-paginated-timeline'
import { useCollapsedBlocks } from './hooks/use-collapsed-blocks'

import { useTheme } from './hooks/use-theme'
import { SelectedFileProvider } from './hooks/use-file-viewer'

import { BOX_CHARS } from './utils/ui-constants'
import { formatTokensCompact } from './utils/format-tokens'
import { hasConversationActivity } from './utils/start-state'

import { AnimatedLogo } from './components/animated-logo'
import { RecentChatsWidget } from './components/recent-chats-widget'
import { SessionLoadingView } from './components/session-loading-view'
import { routeSlashCommand, type CommandContext } from './commands/command-router'
import { INIT_PROMPT } from './commands/init-prompt'
import { registerSkillCommands, type SlashCommandDefinition } from './commands/slash-commands'
import { useSelectionAutoCopy } from './utils/clipboard'
import { useRecentChatsNavigation } from './hooks/use-recent-chats-navigation'

import { AppOverlays } from './components/app-overlays'



import { getRecentChats, type RecentChat } from './data/recent-chats'
import { logger, initLogger, subscribeToLogs, clearSessionLog, getSessionLogPath, type LogEntry } from '@magnitudedev/logger'



import { executeBashCommand, type BashResult } from './utils/bash-executor'


import { BashOutput } from './components/bash-output'


import { FileViewerPanel } from './components/file-viewer-panel'
import type { Attachment } from '@magnitudedev/agent'
import { DebugPanel } from './components/debug-panel'
import { ChatController } from './components/chat/chat-controller'
import { useTasks } from './hooks/use-tasks'
import { useLocalWidth } from './hooks/use-local-width'


import { TextAttributes, type KeyEvent } from '@opentui/core'

import { createId } from '@magnitudedev/generate-id'

import { useStorage } from './providers/storage-provider'
import { useFilePanel } from './hooks/use-file-panel'
import { useLazyClient } from './hooks/use-lazy-client'
import { useMagnitudeAuth } from './hooks/use-magnitude-auth'
import { MagnitudeLoginScreen } from './components/magnitude-login-screen'
import { WindowsWarningScreen } from './components/windows-warning-screen'
import { createRoles, ROLE_IDS, type RoleId } from '@magnitudedev/roles'

export const getSelectedForkContentVersion = (
  selectedForkId: string | null,
  forkDisplay: Pick<DisplayState, 'messages' | 'pendingInboundCommunications'> | null
): string => {
  if (!selectedForkId) return 'main'
  return [
    selectedForkId,
    forkDisplay?.messages.length ?? 0,
    forkDisplay?.pendingInboundCommunications.length ?? 0,
  ].join(':')
}

type AgentClient = Awaited<ReturnType<typeof createCodingAgentClient>>

export type SessionStart =
  | { _tag: 'new' }
  | { _tag: 'latest' }
  | { _tag: 'resume'; sessionId: string }

export function App({ sessionStart, debug, onClientReady, onSessionId }: { sessionStart: SessionStart; debug: boolean; onClientReady?: (client: AgentClient | null) => void; onSessionId?: (id: string) => void }) {
  const [conversationKey, setConversationKey] = useState(0)
  const [sessionSelection, setSessionSelection] = useState<string | null | undefined>(
    sessionStart._tag === 'new' ? null : sessionStart._tag === 'latest' ? undefined : sessionStart.sessionId
  )
  const hasAnimatedRef = useRef(false)

  const handleReset = useCallback(() => {
    hasAnimatedRef.current = true
    setSessionSelection(null)
    setConversationKey(prev => prev + 1)
  }, [])

  const handleResumeSession = useCallback((sessionId: string) => {
    hasAnimatedRef.current = true
    setSessionSelection(sessionId)
    setConversationKey(prev => prev + 1)
  }, [])

  return (
    <AppInner
      debugMode={debug}
      key={conversationKey}
      skipAnimation={hasAnimatedRef.current}
      sessionSelection={sessionSelection}
      onReset={handleReset}
      onResumeSession={handleResumeSession}
      onClientReady={onClientReady}
      onSessionId={onSessionId}
    />
  )
}

function AppInner({
  debugMode,
  skipAnimation,
  sessionSelection,
  onReset,
  onResumeSession,
  onClientReady,
  onSessionId,
}: {
  debugMode: boolean
  skipAnimation: boolean
  sessionSelection: string | null | undefined
  onReset: () => void
  onResumeSession: (sessionId: string) => void
  onClientReady?: (client: AgentClient | null) => void
  onSessionId?: (id: string) => void
}) {
  const renderer = useRenderer()
  const storage = useStorage()
  const auth = useMagnitudeAuth()
  const { client, scratchpadPath, send: clientSend, ensureReady: ensureClientReady, setFactory: setClientFactory, setClient: setLazyClient } = useLazyClient()

  const [display, setDisplay] = useState<DisplayState | null>(null)
  const [toolState, setToolState] = useState<TurnState | null>(null)
  const [agentStatusState, setAgentStatusState] = useState<AgentStatusState | null>(null)
  const [expandedForkStack, setExpandedForkStack] = useState<string[]>([])
  const expandedForkId = expandedForkStack.length > 0 ? expandedForkStack[expandedForkStack.length - 1] : null
  const pushForkOverlay = (forkId: string) => setExpandedForkStack(s => [...s, forkId])
  const popForkOverlay = () => {
    setExpandedForkStack(s => s.slice(0, -1))
  }

  const [forkDisplay, setForkDisplay] = useState<DisplayState | null>(null)
  const [forkTokenEstimate, setForkTokenEstimate] = useState(0)

  const [forkIsCompacting, setForkIsCompacting] = useState(false)

  const [systemMessages, setSystemMessages] = useState<Array<{ id: string; text: string; timestamp: number }>>([])
  const systemMessageTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [showRecentChatsOverlay, setShowRecentChatsOverlay] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [roleProfiles, setRoleProfiles] = useState<Partial<Record<RoleId, RoleProfile>> | null>(null)
  const contextHardCap = roleProfiles?.leader?.contextWindow ?? null

  const [bashMode, setBashMode] = useState(false)
  const [bashOutputs, setBashOutputs] = useState<BashResult[]>([])
  const [debugPanelVisible, setDebugPanelVisible] = useState(false)
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null)
  const [debugEvents, setDebugEvents] = useState<AppEvent[]>([])
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([])
  const [composerHasContent, setComposerHasContent] = useState(false)
  const [restoredQueuedInputText, setRestoredQueuedInputText] = useState<string | null>(null)
  const [tokenEstimate, setTokenEstimate] = useState(0)
  const [isCompacting, setIsCompacting] = useState(false)
  const turnStartTimeRef = useRef<number | null>(null)
  const hasAnimatedRef = useRef(skipAnimation)

  const formatFooterTokens = formatTokensCompact
  const tokenUsage = tokenEstimate > 0 ? tokenEstimate : null
  const contextPercent = (tokenUsage != null && contextHardCap) ? Math.round((tokenUsage / contextHardCap) * 100) : null
  const contextDisplayText = tokenUsage == null
    ? '-'
    : (contextHardCap
      ? `${contextPercent}% ${formatFooterTokens(tokenUsage)}/${formatFooterTokens(contextHardCap)}`
      : `${formatFooterTokens(tokenUsage)}/Unknown`)
  const contextRenderedText = isCompacting ? `>>> ${contextDisplayText} <<<` : contextDisplayText

  // Always reserve width for the longest possible escape hint so that
  // attachments don't reflow when hints appear/disappear.
  const maxEscHintWidth = 'Press Esc again to interrupt all workers'.length

  const chatColumn = useLocalWidth()
  const chatColumnWidth = chatColumn.width ?? 80
  const footerRightGap = contextRenderedText ? 1 : 0
  const footerHorizontalPadding = 4
  const footerSafetyBuffer = 4
  const attachmentsMaxWidth = Math.max(
    0,
    chatColumnWidth
      - footerHorizontalPadding
      - maxEscHintWidth
      - contextRenderedText.length
      - footerRightGap
      - footerSafetyBuffer,
  )



  const [recentChatsSelectedIndex, setRecentChatsSelectedIndex] = useState(0)

  const [recentChats, setRecentChats] = useState<RecentChat[] | null>(null)

  const refreshRecentChats = useCallback(() => {
    getRecentChats(storage).then(setRecentChats)
  }, [storage])

  useEffect(() => {
    logger.info('App started')
    if (debugMode) logger.info('Debug mode enabled - press Ctrl+X to toggle debug panel')
    refreshRecentChats()
  }, [debugMode, refreshRecentChats])



  useEffect(() => {
    if (!auth.loaded || !auth.key) return
    let cancelled = false
    fetchRoleProfiles(auth.key)
      .then(profiles => {
        if (!cancelled) setRoleProfiles(profiles)
      })
      .catch(err => logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to load role profiles'))
    return () => { cancelled = true }
  }, [auth.loaded, auth.key])

  // Subscribe to live logs for debug panel
  useEffect(() => {
    if (!debugMode) return
    return subscribeToLogs((entry) => {
      setDebugLogs(prev => [...prev, entry])
    })
  }, [debugMode])

  useEffect(() => {
    if (showRecentChatsOverlay) {
      refreshRecentChats()
    }
  }, [showRecentChatsOverlay, refreshRecentChats])

  useEffect(() => {
    if (!auth.loaded || !auth.key) {
      return
    }
    let mounted = true
    let c: AgentClient | null = null

    // Register skills as slash commands (fire-and-forget, non-blocking)
    loadSkills(process.cwd()).then((skillsMap) => {
      const commands: SlashCommandDefinition[] = []

      for (const s of skillsMap.values()) {
        commands.push({
          id: s.name,
          label: s.name,
          description: s.description,
          source: 'skill' as const,
          skillPath: s.path,
        })
      }

      if (commands.length > 0) {
        registerSkillCommands(commands)
        logger.info({ count: commands.length, names: commands.map(c => c.id) }, 'Registered skill commands')
      }
    }).catch((err) => {
      logger.warn({ error: err.message }, 'Failed to load skills')
    })

    let resolvedScratchpadPath: string | null = null
    let resolvedSessionId: string | null = null

    const createClient = async () => {
      let sessionId: string | undefined
      if (sessionSelection === undefined) {
        sessionId = await storage.sessions.findLatest() ?? undefined
      } else if (sessionSelection === null) {
        sessionId = undefined
      } else {
        sessionId = sessionSelection
      }

      const persistence = new JsonChatPersistence({
        storage,
        workingDirectory: process.cwd(),
        sessionId,
      })
      const activeSessionId = persistence.getSessionId()
      resolvedSessionId = activeSessionId
      onSessionId?.(activeSessionId)
      resolvedScratchpadPath = storage.sessions.getScratchpadPath(activeSessionId) ?? null
      initLogger(persistence.getSessionId())
      clearSessionLog(persistence.getSessionId())
      logger.info({ logFile: getSessionLogPath(persistence.getSessionId()) }, 'Session logger initialized')
      const persistenceLayer = Layer.succeed(ChatPersistence, persistence)
      return createCodingAgentClient({
        persistence: persistenceLayer,
        storage,
        debug: debugMode,
        sessionId: activeSessionId,
        magnitudeApiKey: auth.key ?? undefined,
      })
    }

    const setupClient = (client: AgentClient) => {
      if (!mounted) {
        client.dispose()
        return
      }
      c = client
      setLazyClient(client, resolvedScratchpadPath)
      onClientReady?.(client)
      renderer.setTerminalTitle("Magnitude")

      // Log all events to event log file + collect for debug panel
      client.onEvent((event) => {
        if (debugMode && mounted) {
          setDebugEvents(prev => [...prev, event])
        }
      })

      // Framework errors bypass the event system entirely — render directly in the TUI
      client.onError((error) => {
        if (!mounted) return
        // Log full cause for debugging; surface a friendly message to the user.
        logger.error({ tag: error._tag, cause: Cause.pretty(error.cause) }, 'Framework error')
        const outcome = classifyUnknownError(error.cause)
        const p = present(outcome)
        if (p.surface !== 'inline') return
        const errorMsg: ErrorDisplayMessage = {
          id: createId(),
          type: 'error',
          message: p.message,
          timestamp: Date.now(),
          cta: p.cta,
        }
        setDisplay(prev => prev ? { ...prev, messages: [...prev.messages, errorMsg] } : prev)
      })

      // Subscribe to agent state (global projection)
      client.state.agentStatus.subscribe((state) => {
        if (mounted) {
          setAgentStatusState(state)
        }
      })

      // Subscribe to restore queued messages signal (only for main/root)
      client.on.restoreQueuedMessages(({ forkId, messages }) => {
        // Only restore if this is for the main agent (not a fork)
        if (mounted && forkId === null && messages.length > 0) {
          const restored = messages.join('\n')
          logger.info({ restored, length: restored.length }, 'Restoring queued messages to input')
          setRestoredQueuedInputText(restored)
        }
      })


      client.state.taskGraph.subscribe((state) => {
        if (!mounted) return
        const title = getSessionTitleFromTaskGraph(state)
        if (!title) return
        logger.info({ title }, 'Session title derived from task graph')
        renderer.setTerminalTitle(title)
      })
    }

    if (sessionSelection === null) {
      // NEW SESSION: defer client creation, show empty UI immediately
      setDisplay({
        status: 'idle',
        messages: [],
        pendingInboundCommunications: [],
        currentTurnId: null,
        streamingMessageId: null,
        activeThinkBlockId: null,
        showButton: 'send',
      })
      setClientFactory(async () => {
        const client = await createClient()
        setupClient(client)
        return client
      })
    } else {
      // RESUMED SESSION: create client immediately (existing behavior)
      setClientFactory(null)
      createClient().catch((err) => {
        logger.error({ error: err.message, stack: err.stack }, 'Failed to create agent client');
        throw err;
      }).then(async (client) => {
        logger.info('Agent client created successfully');
        setupClient(client)

        if (!resolvedSessionId) return

        const summary = await loadSessionSummary(storage, resolvedSessionId)
        if (summary?.title) {
          renderer.setTerminalTitle(summary.title)
        }
      })
    }

    return () => {
      mounted = false
      setClientFactory(null)
      onClientReady?.(null)
      c?.dispose()
    }
  }, [debugMode, onClientReady, onSessionId, renderer, sessionSelection, setClientFactory, setLazyClient, storage, auth.loaded, auth.key])

  // Subscribe to display state for selected fork
  useEffect(() => {
    if (!client) {
      logger.warn("handleInterrupt: no client, returning")
      return
    }

    const unsubscribe = client.state.display.subscribeFork(null, (state) => {
      if (state.status === 'streaming' && turnStartTimeRef.current === null) {
        turnStartTimeRef.current = Date.now()
      } else if (state.status === 'idle') {
        turnStartTimeRef.current = null
      }
      if (state.streamingMessageId) {
        lastStreamingMessageIdRef.current = state.streamingMessageId
      }
      if (state.status === 'streaming') {
        interruptedMessageIdRef.current = null
      } else if (state.status === 'idle' && state.messages.some(m => m.type === 'interrupted')) {
        interruptedMessageIdRef.current = lastStreamingMessageIdRef.current
      }
      setDisplay(state)
    })

    return unsubscribe
  }, [client])

  useEffect(() => {
    const onFocus = () => {
      client?.send({ type: 'window_focus_changed', forkId: null, focused: true })
    }
    const onBlur = () => {
      client?.send({ type: 'window_focus_changed', forkId: null, focused: false })
    }
    renderer.on('focus', onFocus)
    renderer.on('blur', onBlur)
    return () => {
      renderer.off('focus', onFocus)
      renderer.off('blur', onBlur)
    }
  }, [renderer, client])

  // Subscribe to compaction state for context usage bar
  useEffect(() => {
    if (!client) return

    const unsubWindow = client.state.memory.subscribeFork(null, (state) => {
      setTokenEstimate(state.tokenEstimate)
    })
    const unsubCompaction = client.state.compaction.subscribeFork(null, (state: CompactionState) => {
      setIsCompacting(state._tag !== 'idle')
    })

    return () => { unsubWindow(); unsubCompaction() }
  }, [client])

  const subscribeForkCompaction = useCallback((forkId: string, cb: (state: CompactionState) => void) => {
    if (!client) return () => {}
    return client.state.compaction.subscribeFork(forkId, cb)
  }, [client])

  const subscribeForkWindow = useCallback((forkId: string, cb: (state: { tokenEstimate: number }) => void) => {
    if (!client) return () => {}
    return client.state.memory.subscribeFork(forkId, cb)
  }, [client])

  // Subscribe to tool state for file panel streaming support
  useEffect(() => {
    if (!client) return

    const unsubscribe = client.state.harnessState.subscribeFork(null, (state) => {
      setToolState(state)
    })

    return unsubscribe
  }, [client])

  const tasks = useTasks({
    client,
  })

  const selectedForkId: string | null = null

  // Subscribe to selected fork's display
  useEffect(() => {
    if (!client || !selectedForkId) {
      setForkDisplay(null)
      return
    }
    const unsubscribe = client.state.display.subscribeFork(selectedForkId, (state) => {
      setForkDisplay(state)
    })
    return unsubscribe
  }, [client, selectedForkId])

  // Subscribe to selected fork's compaction state
  useEffect(() => {
    if (!client || !selectedForkId) {
      setForkTokenEstimate(0)
      setForkIsCompacting(false)
      return
    }
    const unsubWindow = client.state.memory.subscribeFork(selectedForkId, (state) => {
      setForkTokenEstimate(state.tokenEstimate)
    })
    const unsubCompaction = client.state.compaction.subscribeFork(selectedForkId, (state: CompactionState) => {
      setForkIsCompacting(state._tag !== 'idle')
    })
    return () => { unsubWindow(); unsubCompaction() }
  }, [client, selectedForkId])

  // Subscribe to debug stream when debug mode is enabled and panel is visible
  useEffect(() => {
    if (!client || !debugMode || !debugPanelVisible) return

    const unsubscribe = client.subscribeDebug(null, (snapshot) => {
      setDebugSnapshot(snapshot)
    })

    return unsubscribe
  }, [client, debugMode, debugPanelVisible])





  const activeDisplay = selectedForkId ? forkDisplay : display

  // Roles data for settings display
  const rolesData = useMemo(() => {
    const roles = createRoles()
    return ROLE_IDS.map(id => ({
      id,
      description: roles[id].description,
      modelDisplayName: roleProfiles?.[id]?.modelDisplayName ?? null,
    }))
  }, [roleProfiles])

  const labelForRole = (id: RoleId): string => id.charAt(0).toUpperCase() + id.slice(1)
  const modelNameForRole = (id: RoleId): string => roleProfiles?.[id]?.modelDisplayName ?? '-'

  const activeModelSummary = useMemo(() => {
    const role: RoleId = (() => {
      if (!selectedForkId || !agentStatusState) return 'leader'
      const agentId = agentStatusState.agentByForkId.get(selectedForkId)
      const agent = agentId ? agentStatusState.agents.get(agentId) : undefined
      const r = agent?.role
      return r && (ROLE_IDS as readonly string[]).includes(r) ? (r as RoleId) : 'leader'
    })()
    return { role: labelForRole(role), model: modelNameForRole(role) }
  }, [selectedForkId, agentStatusState, roleProfiles])

  // Vision support — assume true since Magnitude handles model capabilities server-side
  const activeModelSupportsVision = true

  const forkRole = useMemo(() => {
    if (!expandedForkId || !agentStatusState) return null
    const agentId = agentStatusState.agentByForkId.get(expandedForkId)
    const agent = agentId ? agentStatusState.agents.get(agentId) : undefined
    if (!agent) return null
    return agent.role
  }, [expandedForkId, agentStatusState])

  const forkModelSummary = useMemo(() => {
    if (!forkRole) return null
    return { role: labelForRole(forkRole), model: modelNameForRole(forkRole) }
  }, [forkRole, roleProfiles])

  const forkContextHardCap = forkRole ? (roleProfiles?.[forkRole]?.contextWindow ?? null) : null

  const mainTimelineMessages = useMemo(
    () => (activeDisplay?.messages ?? []).filter(m => {
      if (m.type === 'fork_activity') return false
      if (selectedForkId === null && m.type === 'agent_communication') return false
      return true
    }),
    [activeDisplay?.messages, selectedForkId]
  )

  const { visibleItems, hiddenCount, loadMore, hasMore } = usePaginatedTimeline(
    mainTimelineMessages,
    bashOutputs,
    systemMessages
  )

  const { isCollapsed, toggleCollapse, collapseBlock } = useCollapsedBlocks()

  // Auto-collapse think blocks when they complete
  const autoCollapsedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const messages = display?.messages ?? []
    for (const msg of messages) {
      if (msg.type === 'think_block' && msg.status === 'completed' && !autoCollapsedRef.current.has(msg.id)) {
        autoCollapsedRef.current.add(msg.id)
        collapseBlock(msg.id)
      }
    }
  }, [display?.messages, collapseBlock])

  const theme = useTheme()
  const { showCopiedToast: clipboardToast } = useSelectionAutoCopy()

  // Ephemeral status bar message (auto-dismisses)
  const [ephemeralMessage, setEphemeralMessage] = useState<{ text: string; color: string } | null>(null)
  const ephemeralTimerRef = useRef<NodeJS.Timeout | null>(null)

  const showEphemeral = useCallback((message: string, color: string, durationMs = 5000) => {
    if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
    setEphemeralMessage({ text: message, color })
    ephemeralTimerRef.current = setTimeout(() => setEphemeralMessage(null), durationMs)
  }, [])

  useEffect(() => {
    return () => { if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current) }
  }, [])

  const hasRunningForks = agentStatusState
    ? Array.from(agentStatusState.agents.values()).some(a => a.status === 'working')
    : false

  // Find pending approval request from display messages (for keyboard intercept)
  const pendingApproval = useMemo(() => {
    if (!display) return null
    const msg = display.messages.find(
      m => m.type === 'approval_request' && m.status === 'pending'
    )
    return msg?.type === 'approval_request' ? msg : null
  }, [display?.messages])


  const handleApprove = useCallback(() => {
    if (!client || !pendingApproval) return
    logger.info({ toolCallId: pendingApproval.toolCallId }, 'Approving tool call')
    client.send({
      type: 'tool_approved',
      forkId: null,
      toolCallId: pendingApproval.toolCallId,
    })
  }, [client, pendingApproval])

  const handleReject = useCallback(() => {
    if (!client || !pendingApproval) return
    logger.info({ toolCallId: pendingApproval.toolCallId }, 'Rejecting tool call')
    client.send({
      type: 'tool_rejected',
      forkId: null,
      toolCallId: pendingApproval.toolCallId,
      reason: 'User rejected',
    })
  }, [client, pendingApproval])


  // Slash command context
  const resetConversation = useCallback(() => {
    if (client) {
      client.dispose()
    }
    onReset()
  }, [client, onReset])

  const showSystemMessage = useCallback((message: string, durationMs = 10000) => {
    const id = createId()
    const existingTimeout = systemMessageTimeoutsRef.current.get(id)
    if (existingTimeout) clearTimeout(existingTimeout)

    setSystemMessages(prev => [...prev, { id, text: message, timestamp: Date.now() }])

    const timeoutId = setTimeout(() => {
      systemMessageTimeoutsRef.current.delete(id)
      setSystemMessages(prev => prev.filter(m => m.id !== id))
    }, durationMs)

    systemMessageTimeoutsRef.current.set(id, timeoutId)
  }, [])

  useEffect(() => {
    return () => {
      for (const timeoutId of systemMessageTimeoutsRef.current.values()) {
        clearTimeout(timeoutId)
      }
      systemMessageTimeoutsRef.current.clear()
    }
  }, [])

  const exitApp = useCallback(() => {
    process.kill(process.pid, 'SIGINT')
  }, [])

  if (process.platform === 'win32') {
    return (
      <WindowsWarningScreen onExit={exitApp} />
    )
  }

  if (auth.loaded && !auth.key) {
    return (
      <MagnitudeLoginScreen
        onSubmit={auth.save}
        onExit={exitApp}
      />
    )
  }

  const openRecentChats = useCallback(() => {
    refreshRecentChats()
    setShowRecentChatsOverlay(true)
  }, [refreshRecentChats])

  const modeColor = theme.modeDefault
  const modeLabel = 'Default'

  const enterBashMode = useCallback(() => {
    setBashMode(true)
  }, [])

  const activateSkill = useCallback((skillName: string, skillPath: string | undefined, args: string) => {
    if (!skillPath) {
      showEphemeral(`Failed to activate /${skillName}: missing skill path`, theme.error, 8000)
      return
    }
    clientSend({
      type: 'skill_activated',
      forkId: null,
      skillName,
      skillPath,
      message: args.trim() || null,
      source: 'user',
    })
    logger.info({ skillName, skillPath, hasArgs: !!args.trim() }, 'Skill activated')
  }, [clientSend, showEphemeral, theme.error])

  const initProject = useCallback(() => {
    clientSend({
      type: 'user_message',
      messageId: createId(),
      timestamp: Date.now(),
      forkId: null,
      content: textParts(INIT_PROMPT),
      attachments: [],
      mode: 'text',
      synthetic: false,
      taskMode: false,
    })
    logger.info('Init project activated')
  }, [clientSend])

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  const openUsage = useCallback(() => {
    setUsageOpen(true)
  }, [])

  const dispatchErrorAction = useCallback((actionId: ActionId) => {
    switch (actionId) {
      case 'open-settings':
        openSettings()
        return
      case 'open-usage':
        openUsage()
        return
    }
  }, [openSettings, openUsage])

  const onUsageClose = useCallback(() => {
    setUsageOpen(false)
  }, [])

  const exitBashMode = useCallback(() => {
    setBashMode(false)
  }, [])

  const handleResumeChat = useCallback((chat: RecentChat) => {
    hasAnimatedRef.current = true
    setShowRecentChatsOverlay(false)
    onResumeSession(chat.id)
  }, [onResumeSession])

  const hasActivity = hasConversationActivity({
    displayMessageCount: (display?.messages ?? []).length,
    bashOutputCount: bashOutputs.length,
  })

  // Navigation for startup widget (active when no activity, overlay closed, and input empty)
  const widgetNavActive = !showRecentChatsOverlay && !hasActivity && !composerHasContent
  const widgetNavigation = useRecentChatsNavigation(
    recentChats ? recentChats.slice(0, 5) : [],
    handleResumeChat,
    widgetNavActive,
  )

  useEffect(() => {
    if (showRecentChatsOverlay) {
      setRecentChatsSelectedIndex(0)
    }
  }, [showRecentChatsOverlay])

  const onSettingsClose = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  const commandContext: CommandContext = useMemo(() => ({
    resetConversation,
    showSystemMessage: (msg: string) => showEphemeral(msg, theme.error, 8000),
    exitApp,
    openRecentChats,
    enterBashMode,
    activateSkill,
    initProject,
    openSettings,
    openUsage,
  }), [resetConversation, showEphemeral, theme.error, exitApp, openRecentChats, enterBashMode, activateSkill, initProject, openSettings, openUsage])



  const handleInterruptFork = useCallback((forkId: string | null) => {
    if (!client) return
    logger.info({ forkId }, 'Sending interrupt event')
    client.send({ type: 'interrupt', forkId })
  }, [client])

  const handleInterrupt = useCallback(() => {
    handleInterruptFork(null)
  }, [handleInterruptFork])

  const handleInterruptAll = useCallback(() => {
    if (!client) return
    logger.info('Interrupt all: interrupting all workers')
    // Interrupt root with allKilled flag
    client.send({ type: 'interrupt', forkId: null, allKilled: true })
    // Interrupt every running fork
    if (agentStatusState) {
      for (const agent of agentStatusState.agents.values()) {
        if (agent.status === 'working') {
          client.send({ type: 'interrupt', forkId: agent.forkId })
        }
      }
    }
  }, [client, agentStatusState])

  const activeOverlayKind =
    showRecentChatsOverlay ? 'recent-chats'
    : (expandedForkId && client) ? 'fork-detail'
    : settingsOpen ? 'settings'
    : usageOpen ? 'usage'
    : 'none'

  const isOverlayActive = activeOverlayKind !== 'none'
  const isBlockingOverlayActive = isOverlayActive
  const canToggleRecentChatsWithCtrlR = activeOverlayKind === 'none' || activeOverlayKind === 'recent-chats'

  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        if (key.defaultPrevented) return

        const isCtrlC = key.ctrl && key.name === 'c' && !key.meta && !key.option
        const isCtrlX = key.ctrl && key.name === 'x' && !key.meta && !key.option
        const isCtrlR = key.ctrl && key.name === 'r' && !key.meta && !key.option

        if (isCtrlC) {
          if (composerHasContent) return
          if ((activeDisplay ?? display)?.status === 'streaming') return
          key.preventDefault()
          process.kill(process.pid, 'SIGINT')
          return
        }

        if (isCtrlX && debugMode) {
          key.preventDefault()
          setDebugPanelVisible(prev => !prev)
          return
        }

        if (isCtrlR) {
          if (!canToggleRecentChatsWithCtrlR) return
          key.preventDefault()
          hasAnimatedRef.current = true
          setShowRecentChatsOverlay(prev => !prev)
        }
      },
      [composerHasContent, debugMode, activeDisplay, display, canToggleRecentChatsWithCtrlR],
    ),
  )

  // Find the most recent inline error with an action CTA — its chord is the
  // active shortcut. Older actionable errors are still clickable via mouse,
  // but their chord is shadowed by the most recent.
  const latestActionableErrorCta = useMemo(() => {
    const messages = (activeDisplay ?? display)?.messages ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.type === 'error' && m.cta?.kind === 'action') return m.cta
    }
    return null
  }, [activeDisplay, display])

  useKeyboard(
    useCallback(
      (key: KeyEvent) => {
        if (key.defaultPrevented) return
        if (activeOverlayKind !== 'none') return
        if (!latestActionableErrorCta) return
        const chord = matchKeyToChord(key)
        if (chord !== latestActionableErrorCta.chord) return
        key.preventDefault()
        dispatchErrorAction(latestActionableErrorCta.actionId)
      },
      [activeOverlayKind, latestActionableErrorCta, dispatchErrorAction],
    ),
  )


  const {
    selectedFile,
    selectedFileContent,
    selectedFileStreaming,
    selectedFileResolvedPath,
    isOpen: isFilePanelOpen,
    canRenderPanel,
    openFile,
    closeFilePanel,
  } = useFilePanel({
    display: activeDisplay ?? display,
    toolState,
    scratchpadPath,
    projectRoot: process.cwd(),
  })

  // Find active expanded think block for sticky header
  const activeThinkBlock = useMemo(() => {
    const messages = display?.messages ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.type === 'think_block' && msg.status === 'active') {
        return msg
      }
    }
    return null
  }, [display?.messages])

  // Scroll-tracking for sticky header
  const scrollboxRef = useRef<any>(null)
  const thinkBlockRef = useRef<any>(null)
  const lastStreamingMessageIdRef = useRef<string | null>(null)
  const interruptedMessageIdRef = useRef<string | null>(null)
  const [headerScrolledOff, setHeaderScrolledOff] = useState(false)

  const snapChatToBottom = useCallback(() => {
    const scrollbox = scrollboxRef.current
    if (!scrollbox) return

    // OpenTUI ScrollBoxRenderable API: use scrollTo(...); scrollTop is a minimal fallback.
    if (typeof scrollbox.scrollTo === 'function') {
      scrollbox.scrollTo(Number.MAX_SAFE_INTEGER)
      return
    }

    if (typeof scrollbox.scrollTop === 'number') {
      scrollbox.scrollTop = Number.MAX_SAFE_INTEGER
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => snapChatToBottom(), 0)
    return () => clearTimeout(t)
  }, [selectedForkId, snapChatToBottom])

  const selectedForkContentVersion = useMemo(
    () => getSelectedForkContentVersion(selectedForkId, forkDisplay),
    [selectedForkId, forkDisplay]
  )

  useEffect(() => {
    if (!selectedForkId) return

    const t1 = setTimeout(() => snapChatToBottom(), 0)
    const t2 = setTimeout(() => snapChatToBottom(), 50)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [selectedForkContentVersion, selectedForkId, snapChatToBottom])

  const showStickyHeader = activeThinkBlock != null && !isCollapsed(activeThinkBlock.id) && headerScrolledOff

  // Poll scroll position to detect when think block header scrolls off-screen
  useEffect(() => {
    if (!activeThinkBlock || isCollapsed(activeThinkBlock.id)) {
      setHeaderScrolledOff(false)
      return
    }

    const checkScroll = () => {
      const scrollbox = scrollboxRef.current
      const thinkBlockEl = thinkBlockRef.current
      if (!scrollbox || !thinkBlockEl) {
        setHeaderScrolledOff(false)
        return
      }

      // Compute absolute Y of think block within scrollbox content
      // by walking up the parent chain summing yoga computed tops
      let offsetY = 0
      let node: any = thinkBlockEl
      const contentNode = scrollbox.content
      while (node && node !== contentNode) {
        const yogaNode = node.yogaNode || node.getLayoutNode?.()
        if (yogaNode) {
          offsetY += yogaNode.getComputedTop()
        }
        node = node.parent
      }

      const scrollTop = scrollbox.scrollTop
      // Trigger 1 row before header fully scrolls off for seamless transition
      const isOff = scrollTop > offsetY - 1
      setHeaderScrolledOff(isOff)
    }

    const interval = setInterval(checkScroll, 50)
    checkScroll()

    return () => clearInterval(interval)
  }, [activeThinkBlock, isCollapsed])

  const handleSubmitViaClientBoundary = useCallback((payload: {
    forkId: string | null
    message: string
    attachments: Attachment[]
  }) => {
    clientSend({
      type: 'user_message',
      messageId: createId(),
      timestamp: Date.now(),
      forkId: payload.forkId,
      content: textParts(payload.message),
      attachments: payload.attachments,
      mode: 'text',
      synthetic: false,
      taskMode: false,
    })
  }, [clientSend])

  if (!display) {
    return (
      <SessionLoadingView
        sessionSelection={sessionSelection}
        recentChats={recentChats}
      />
    )
  }

  const overlayContent = (
    <AppOverlays
      settingsVisible={settingsOpen}
      onSettingsClose={onSettingsClose}
      auth={auth}
      roles={rolesData}
      showRecentChatsOverlay={showRecentChatsOverlay}
      recentChats={recentChats}
      recentChatsSelectedIndex={recentChatsSelectedIndex}
      setRecentChatsSelectedIndex={setRecentChatsSelectedIndex}
      setShowRecentChatsOverlay={setShowRecentChatsOverlay}
      handleResumeChat={handleResumeChat}
      expandedForkId={expandedForkId}
      client={client}
      agentStatusState={agentStatusState}
      forkModelSummary={forkModelSummary}
      forkContextHardCap={forkContextHardCap}
      popForkOverlay={popForkOverlay}
      pushForkOverlay={pushForkOverlay}
      scratchpadPath={scratchpadPath}
      projectRoot={process.cwd()}
      showCopiedToast={clipboardToast}
      usageVisible={usageOpen}
      onUsageClose={onUsageClose}
      onErrorAction={dispatchErrorAction}
    />
  )

  const chatScrollbox = (
    <scrollbox
      ref={scrollboxRef}
      focusable={false}
      stickyScroll
      stickyStart="bottom"
      scrollX={false}
      scrollbarOptions={{ visible: false }}
      verticalScrollbarOptions={{
        visible: display.status === 'idle',
        trackOptions: { width: 1 },
      }}
      style={{
        flexGrow: 1,
        rootOptions: {
          flexGrow: 1,
          backgroundColor: 'transparent',
        },
        wrapperOptions: {
          border: false,
          backgroundColor: 'transparent',
        },
        contentOptions: {
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          justifyContent: 'flex-end',
        },
      }}
    >
      <box style={{ paddingLeft: 1, paddingBottom: 1 }}>
        <AnimatedLogo />
      </box>

      <box style={{ paddingLeft: 1, flexDirection: 'row' }}>
        <text style={{ fg: theme.muted }}>Current directory: </text>
        <text style={{ fg: theme.muted }} attributes={TextAttributes.BOLD}>{process.cwd().replace(process.env.HOME || '', '~')}</text>
      </box>

      <box style={{ paddingLeft: 1, paddingBottom: (hasActivity || (recentChats !== null && recentChats.length === 0)) ? 1 : 0, flexDirection: 'row' }}>
        <text style={{ fg: theme.foreground }} attributes={TextAttributes.BOLD}>Tip: </text>
        <text style={{ fg: theme.muted }}>Use </text>
        <text style={{ fg: theme.foreground }}>/settings</text>
        <text style={{ fg: theme.muted }}> to view your connection and roles.</text>
      </box>

      {!hasActivity && (
        <box style={{ paddingLeft: 1 }}>
          <RecentChatsWidget
            chats={recentChats ? recentChats.slice(0, 5) : []}
            loading={recentChats === null}
            selectedIndex={widgetNavigation.selectedIndex}
            onSelect={handleResumeChat}
            onHoverIndex={widgetNavigation.setSelectedIndex}
            onOpenAll={openRecentChats}
            isNavigationActive={widgetNavActive}
          />
        </box>
      )}

      {hasMore && (
        <LoadPreviousButton hiddenCount={hiddenCount} onLoadMore={loadMore} />
      )}
      {(() => {
        type MergedItem = { kind: 'timeline'; item: (typeof visibleItems)[number] }

        const mergedItems: MergedItem[] = [
          ...visibleItems.map(item => ({ kind: 'timeline' as const, item })),
        ].sort((a, b) => a.item.timestamp - b.item.timestamp)

        return mergedItems.map((merged) => {
          const item = merged.item
          switch (item.kind) {
            case 'chat': {
              const msg = item.message
              const isStreamingMsg = display.status === 'streaming'
                && display.streamingMessageId === msg.id
              const isInterrupted = interruptedMessageIdRef.current === msg.id
              return (
                <ErrorBoundary key={msg.id} fallback={(err) => (
                  <box style={{ paddingLeft: 1 }}>
                    <text style={{ fg: theme.error }}>[Render error: {err.message}]</text>
                  </box>
                )}>
                  <MessageView
                    message={msg}
                    isStreaming={isStreamingMsg}
                    isInterrupted={isInterrupted}
                    isCollapsed={msg.type === 'think_block' ? isCollapsed(msg.id) : undefined}
                    onToggleCollapse={msg.type === 'think_block' ? () => toggleCollapse(msg.id) : undefined}
                    hideThinkBlockHeader={msg.type === 'think_block' && msg.status === 'active' && !isCollapsed(msg.id) && headerScrolledOff}
                    onThinkBlockHeaderRef={msg.type === 'think_block' && msg.status === 'active' ? (ref: any) => { thinkBlockRef.current = ref } : undefined}
                    pendingApproval={pendingApproval != null}
                    onApprove={handleApprove}
                    onReject={handleReject}

                    inputHasText={composerHasContent}
                    onFileClick={openFile}
                    onForkExpand={pushForkOverlay}
                    onErrorAction={dispatchErrorAction}
                  />
                </ErrorBoundary>
              )
            }
            case 'bash':
              return (
                <box key={item.id} style={{ paddingLeft: 1 }}>
                  <BashOutput result={item.result} />
                </box>
              )
            case 'system':
              return (
                <box key={item.id} style={{ paddingLeft: 1, paddingBottom: 1 }}>
                  <text style={{ fg: theme.muted }}>{item.text}</text>
                </box>
              )
          }
        })
      })()}
      {selectedForkId !== null && (
        <PendingCommunicationsPanel
          messages={activeDisplay?.pendingInboundCommunications ?? []}
          onFileClick={openFile}
        />
      )}
    </scrollbox>
  )



  const composerCanFocus = !showRecentChatsOverlay
    && !settingsOpen
    && !usageOpen
    && expandedForkId === null

  const debugVisible = debugMode && debugPanelVisible
  return (
    <SelectedFileProvider value={selectedFile}>
    {isOverlayActive && overlayContent}
    <box style={{ visible: !isOverlayActive, flexDirection: 'row', height: '100%', paddingBottom: 0, marginBottom: 0 }}>
      {/* Left column — debug panel (only when enabled and visible) */}
      {debugVisible && (
        <box style={{ width: '35%', flexShrink: 0, paddingLeft: 1, paddingBottom: 1 }}>
          <DebugPanel debugSnapshot={debugSnapshot} events={debugEvents} logs={debugLogs} onToggle={() => setDebugPanelVisible(false)} />
        </box>
      )}

      {/* Center column — chat, status bar, input, footer */}
      <box
        ref={chatColumn.ref}
        onSizeChange={chatColumn.onSizeChange}
        style={{ flexDirection: 'column', flexGrow: 1, minWidth: 0, position: 'relative', height: '100%', paddingBottom: 0, marginBottom: 0 }}
      >
        <box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
          {showStickyHeader && activeThinkBlock && (
            <box style={{ flexShrink: 0, paddingLeft: 2 }}>
              <StickyWorkingHeader
                timerStartTime={activeThinkBlock.timestamp}
                onToggle={() => toggleCollapse(activeThinkBlock.id)}
                pendingApproval={pendingApproval != null}
              />
            </box>
          )}
          {chatScrollbox}
          <ChatController
            isBlockingOverlayActive={isBlockingOverlayActive}
            env={{
              status: (activeDisplay ?? display)?.status ?? 'idle',
              pendingApproval: pendingApproval != null,
              hasRunningForks,
              bashMode,
              modelsConfigured: true,
              modelSummary: activeModelSummary,
              tokenUsage: selectedForkId
                ? (forkTokenEstimate > 0 ? forkTokenEstimate : null)
                : tokenUsage,
              contextHardCap,
              isCompacting: selectedForkId ? forkIsCompacting : isCompacting,
              theme,
              modeColor,
              attachmentsMaxWidth,
              composerCanFocus,
              widgetNavActive,
              isSubagentView: selectedForkId !== null,
              supportsVision: activeModelSupportsVision,
            }}
            services={{
              submitUserMessageToFork: ({ forkId, message, attachments }) => handleSubmitViaClientBoundary({ forkId, message, attachments }),
              runSlashCommand: (commandText: string) => routeSlashCommand(commandText, commandContext),
              executeBash: async (command: string) => {
                const { scratchpadPath: wp } = await ensureClientReady()
                return executeBashCommand(command, {
                  scratchpadPath: wp!,
                  projectRoot: process.cwd(),
                })
              },
              appendBashOutput: (result) => setBashOutputs(prev => [...prev, result]),
              recordBashCommand: (result) => {
                clientSend({
                  type: 'user_bash_command',
                  forkId: null,
                  timestamp: result.timestamp,
                  command: result.command,
                  cwd: result.cwd,
                  exitCode: result.exitCode,
                  stdout: result.stdout,
                  stderr: result.stderr,
                })
              },
              clearSystemBanners: () => {
                setSystemMessages([])
                for (const timeoutId of systemMessageTimeoutsRef.current.values()) {
                  clearTimeout(timeoutId)
                }
                systemMessageTimeoutsRef.current.clear()
                if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
                setEphemeralMessage(null)
              },
              interruptFork: handleInterruptFork,
              interruptAll: handleInterruptAll,
              openSettings,

              handleWidgetKeyEvent: widgetNavigation.handleKeyEvent,
              enterBashMode: () => setBashMode(true),
              exitBashMode: exitBashMode,
              requestIdleSubagentClose: ({ forkId, agentId }) => {
                const agent = agentStatusState
                  ? Array.from(agentStatusState.agents.values()).find((a) => a.forkId === forkId && a.agentId === agentId)
                  : undefined
                const parentForkId = agent?.parentForkId ?? null
                client?.send({
                  type: 'subagent_idle_closed',
                  forkId,
                  parentForkId,
                  agentId,
                  source: 'idle_tab_close',
                })
              },
              requestActiveSubagentKill: ({ forkId, agentId }) => {
                const agent = agentStatusState
                  ? Array.from(agentStatusState.agents.values()).find((a) => a.forkId === forkId && a.agentId === agentId)
                  : undefined
                const parentForkId = agent?.parentForkId ?? null
                client?.send({
                  type: 'subagent_user_killed',
                  forkId,
                  parentForkId,
                  agentId,
                  source: 'tab_close_confirm',
                })
              },
              showToast: (message: string) => showEphemeral(message, theme.error, 5000),
            }}
            displayMessages={(activeDisplay ?? display).messages}
            tasks={tasks}
            selectedForkId={selectedForkId}
            pushForkOverlay={pushForkOverlay}
            roleProfiles={roleProfiles}
            subscribeForkCompaction={subscribeForkCompaction}
            subscribeForkWindow={subscribeForkWindow}
            selectedFileOpen={isFilePanelOpen}
            onCloseFilePanel={closeFilePanel}
            onApprove={handleApprove}
            onReject={handleReject}
            onInputHasTextChange={setComposerHasContent}
            restoredQueuedInputText={restoredQueuedInputText}
            onRestoredQueuedInputHandled={() => setRestoredQueuedInputText(null)}
          />
        </box>

        {/* Clipboard copy toast — bottom-right overlay */}
        {clipboardToast && (
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

        {/* Ephemeral toast — bottom-right overlay */}
        {ephemeralMessage && (
          <box style={{ position: 'absolute', bottom: 1, right: 2 }}>
            <box style={{
              borderStyle: 'single',
              border: ['left'],
              borderColor: ephemeralMessage.color,
              customBorderChars: { ...BOX_CHARS, vertical: '┃' },
            }}>
              <box style={{
                backgroundColor: theme.surface,
                paddingTop: 1,
                paddingBottom: 1,
                paddingLeft: 2,
                paddingRight: 2,
              }}>
                <text style={{ fg: ephemeralMessage.color }}>{ephemeralMessage.text}</text>
              </box>
            </box>
          </box>
        )}



      </box>

      {canRenderPanel && selectedFile && (
        <box style={{ width: '45%', flexShrink: 0, paddingRight: 1, paddingBottom: 1 }}>
          <FileViewerPanel
            key={selectedFile.path}
            filePath={selectedFile.path}
            content={selectedFileContent}
            scrollToSection={selectedFile.section}
            onClose={closeFilePanel}
            onOpenFile={openFile}
            streaming={selectedFileStreaming}
          />
        </box>
      )}

    </box>
    </SelectedFileProvider>
  )
}
