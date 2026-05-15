import { TextAttributes } from '@opentui/core'
import { blue, red, slate } from '../../../utils/palette'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../../hooks/use-theme'
import { useLocalWidth } from '../../../hooks/use-local-width'
import { Button } from '../../button'
import { computeWorkerElapsedMs, formatWorkerTimer, isWorkerResumed } from '../../../utils/task-list-worker-timer'
import { BOX_CHARS } from '../../../utils/ui-constants'
import { formatTokensCompact } from '../../../utils/format-tokens'
import {
  computeInheritedVisualStatusMap,
  type VisualStatus,
} from '../../../utils/task-visual-status'
import {
  buildRootSummaries,
  findOwningRootIndex,
} from '../../../utils/task-tree'
import type {
  TaskDisplayRow,
  TaskListItem,
  TaskAssigneeSlot,
  WorkerSlotDisplay,
} from './types'
import type { SubscribeForkCompaction, SubscribeForkWindow } from '../types'
import type { RoleProfile } from '@magnitudedev/agent'
import type { RoleId } from '@magnitudedev/roles'
import { isRoleId } from '@magnitudedev/roles'

const COLLAPSED_ROWS = 6
const EXPANDED_ROWS = 25

export function getVisibleTasks(tasks: readonly TaskListItem[], expanded: boolean): readonly TaskListItem[] {
  return expanded ? tasks : tasks.slice(-COLLAPSED_ROWS)
}

export function scheduleInitialTaskListSnap(
  scrollToBottom: () => void,
  schedule: typeof setTimeout = setTimeout,
  cancel: typeof clearTimeout = clearTimeout,
): () => void {
  const t1 = schedule(scrollToBottom, 0)
  const t2 = schedule(scrollToBottom, 50)
  return () => { cancel(t1); cancel(t2) }
}

const PULSE_BLUE_SHADES = [
  blue[50], blue[100], blue[200], blue[300], blue[400], blue[500], blue[600], blue[700], blue[800], blue[900],
  blue[800], blue[700], blue[600], blue[500], blue[400], blue[300], blue[200], blue[100], blue[50],
] as const

type Props = {
  tasks: readonly TaskListItem[]
  pushForkOverlay: (forkId: string) => void
  roleProfiles: Partial<Record<RoleId, RoleProfile>> | null
  subscribeForkCompaction: SubscribeForkCompaction
  subscribeForkWindow: SubscribeForkWindow
  scrollRefOverride?: { current: { scrollTo: (offset: number) => void } | null }
}

type TaskRowProps = {
  task: TaskListItem
  effectiveStatus: VisualStatus
  pushForkOverlay: (forkId: string) => void
  hovered: boolean
  onHover: (taskId: string) => void
  onHoverEnd: () => void
  now: number
  taskNameWidth: number
  columnGap: number
  agentIdWidth: number
  roleProfiles: Partial<Record<RoleId, RoleProfile>> | null
  subscribeForkCompaction: SubscribeForkCompaction
  subscribeForkWindow: SubscribeForkWindow
}

type WorkerPresentation = {
  icon: string
  iconColor: string
  labelColor: string
  timerColor: string
  showTimer: boolean
  showResumed: boolean
  interactiveForkId: string | null
}

function truncate(s: string, maxWidth: number) {
  return s.length > maxWidth ? s.slice(0, maxWidth - 1) + '…' : s
}

function splitWorkerLabel(label: string): { badgeText: string; nameText: string } {
  const match = label.match(/^(\[[^\]]+\])\s+(.+)$/)
  if (match) return { badgeText: match[1], nameText: match[2] }
  return { badgeText: '', nameText: label }
}

const NAME_MIN_WIDTH = 4

function pickAssigneeLayout(args: {
  agentIdWidth: number
  iconWidth: number
  badgeText: string
  nameText: string
  modelText: string
  timerWidth: number
  tokensWidth: number
}) {
  const { agentIdWidth, iconWidth, badgeText, nameText, modelText, timerWidth, tokensWidth } = args
  const badgeWidth = badgeText ? badgeText.length + 1 : 0 // includes trailing space
  const modelWidth = modelText ? ` · ${modelText}`.length : 0

  const fits = (showBadge: boolean, showModel: boolean, showTokens: boolean, nameWidth: number) => {
    const used = iconWidth
      + (showBadge ? badgeWidth : 0)
      + nameWidth
      + (showModel ? modelWidth : 0)
      + timerWidth
      + (showTokens ? tokensWidth : 0)
    return used <= agentIdWidth
  }

  // Try, in order: full → drop tokens → drop badge → drop model → truncate name
  if (fits(!!badgeText, !!modelText, tokensWidth > 0, nameText.length)) {
    return { showBadge: !!badgeText, showModel: !!modelText, showTokens: tokensWidth > 0, nameMaxWidth: nameText.length }
  }
  if (fits(!!badgeText, !!modelText, false, nameText.length)) {
    return { showBadge: !!badgeText, showModel: !!modelText, showTokens: false, nameMaxWidth: nameText.length }
  }
  if (fits(false, !!modelText, false, nameText.length)) {
    return { showBadge: false, showModel: !!modelText, showTokens: false, nameMaxWidth: nameText.length }
  }
  if (fits(false, false, false, nameText.length)) {
    return { showBadge: false, showModel: false, showTokens: false, nameMaxWidth: nameText.length }
  }
  // Truncate name to whatever fits with just icon + timer
  const nameMaxWidth = Math.max(NAME_MIN_WIDTH, agentIdWidth - iconWidth - timerWidth)
  return { showBadge: false, showModel: false, showTokens: false, nameMaxWidth }
}

function getStatusGlyph(status: VisualStatus): '✓' | '○' {
  return status === 'completed' ? '✓' : '○'
}

function getStatusColor(status: VisualStatus, theme: ReturnType<typeof useTheme>): string {
  return status === 'completed' ? theme.success : theme.muted
}

function buildTaskTitleText(task: TaskDisplayRow) {
  return task.title
}

function getTaskIndent(depth: number): string {
  return depth > 0 ? '  '.repeat(depth) : ''
}

function getAssigneeLabel(assignee: TaskAssigneeSlot): string {
  if (assignee.kind === 'none') return ''
  return assignee.label
}

function getWorkerPresentation(
  assignee: TaskAssigneeSlot,
  now: number,
  theme: ReturnType<typeof useTheme>,
  hovered: boolean,
): WorkerPresentation | null {
  switch (assignee.kind) {
    case 'none':
      return null
    case 'ghost':
      return {
        icon: assignee.icon,
        iconColor: red[500],
        labelColor: slate[500],
        timerColor: slate[500],
        showTimer: false,
        showResumed: false,
        interactiveForkId: null,
      }
    case 'user':
      return {
        icon: '',
        iconColor: theme.warning ?? theme.foreground,
        labelColor: theme.warning ?? theme.foreground,
        timerColor: theme.warning ?? theme.foreground,
        showTimer: false,
        showResumed: false,
        interactiveForkId: null,
      }
    case 'worker': {
      const labelBaseColor = assignee.tone === 'muted' ? theme.muted : theme.foreground
      const labelHoverColor = assignee.tone === 'active'
        ? theme.primary
        : assignee.tone === 'muted'
          ? slate[300]
          : labelBaseColor
      const labelColor = hovered && assignee.interactiveForkId ? labelHoverColor : labelBaseColor

      switch (assignee.variant) {
        case 'spawning':
          return {
            icon: assignee.icon,
            iconColor: PULSE_BLUE_SHADES[Math.floor(now / 200) % PULSE_BLUE_SHADES.length],
            labelColor,
            timerColor: theme.muted,
            showTimer: false,
            showResumed: false,
            interactiveForkId: null,
          }
        case 'working':
          return {
            icon: assignee.icon,
            iconColor: PULSE_BLUE_SHADES[Math.floor(now / 200) % PULSE_BLUE_SHADES.length],
            labelColor,
            timerColor: theme.muted,
            showTimer: true,
            showResumed: true,
            interactiveForkId: assignee.interactiveForkId,
          }
        case 'idle':
          return {
            icon: assignee.icon,
            iconColor: slate[600],
            labelColor,
            timerColor: labelBaseColor,
            showTimer: true,
            showResumed: true,
            interactiveForkId: assignee.interactiveForkId,
          }
        case 'killing':
          return {
            icon: assignee.icon,
            iconColor: red[500],
            labelColor,
            timerColor: labelColor,
            showTimer: false,
            showResumed: false,
            interactiveForkId: assignee.interactiveForkId,
          }
      }
    }
  }
}

function TaskNameContent({
  task,
  effectiveStatus,
  taskNameWidth,
  theme,
}: {
  task: TaskDisplayRow
  effectiveStatus: VisualStatus
  taskNameWidth: number
  theme: ReturnType<typeof useTheme>
}) {
  const isCompleted = task.status === 'completed'
  const indent = getTaskIndent(task.depth)
  const glyphText = `${getStatusGlyph(effectiveStatus)} `
  const prefixWidth = indent.length + glyphText.length
  const titleText = buildTaskTitleText(task)
  const taskNameStr = truncate(titleText, Math.max(1, taskNameWidth - prefixWidth))

  return (
    <>
      {indent.length > 0 && <text style={{ fg: theme.muted }}>{indent}</text>}
      <text style={{ fg: getStatusColor(effectiveStatus, theme) }}>{glyphText}</text>
      {isCompleted
        ? <text attributes={TextAttributes.STRIKETHROUGH} style={{ fg: theme.muted }}>{taskNameStr}</text>
        : <text style={{ fg: theme.foreground }}>{taskNameStr}</text>}
    </>
  )
}

function TaskRow({
  task,
  effectiveStatus,
  pushForkOverlay,
  hovered,
  onHover,
  onHoverEnd,
  now,
  taskNameWidth,
  columnGap,
  agentIdWidth,
  roleProfiles,
  subscribeForkCompaction,
  subscribeForkWindow,
}: TaskRowProps) {
  const theme = useTheme()
  const workerPresentation = getWorkerPresentation(task.assignee, now, theme, hovered)
  const workerLabel = getAssigneeLabel(task.assignee)
  const workerTimerSnapshot = (() => {
    if (task.assignee.kind !== 'worker' || !('workerState' in task.assignee)) return null
    const ws = task.assignee.workerState
    if (ws.status === 'unassigned' || ws.status === 'spawning' || ws.status === 'killing') return null
    return {
      state: ws.status,
      activeSince: ws.status === 'working' ? ws.activeSince : null,
      accumulatedActiveMs: ws.accumulatedMs,
      resumeCount: ws.resumeCount,
    }
  })()
  const workerTimer = workerTimerSnapshot && workerPresentation?.showTimer
    ? formatWorkerTimer(computeWorkerElapsedMs(workerTimerSnapshot, now))
    : null
  const workerResumed = workerTimerSnapshot && workerPresentation?.showResumed
    ? isWorkerResumed(workerTimerSnapshot)
    : false
  const canOpenWorkerFork = Boolean(workerPresentation?.interactiveForkId)

  const workerForkId = workerPresentation?.interactiveForkId ?? null
  const [workerTokens, setWorkerTokens] = useState<number | null>(null)

  useEffect(() => {
    if (!workerForkId) {
      setWorkerTokens(null)
      return
    }
    const unsub = subscribeForkWindow(workerForkId, (state) => {
      setWorkerTokens(state.tokenEstimate > 0 ? state.tokenEstimate : null)
    })
    return unsub
  }, [workerForkId, subscribeForkWindow])

  const workerRole = task.assignee.kind === 'worker' && 'role' in task.assignee ? task.assignee.role : null
  const modelDisplayName = workerRole && isRoleId(workerRole)
    ? (roleProfiles?.[workerRole]?.modelDisplayName ?? null)
    : null
  const tokensLabel = workerTokens != null ? formatTokensCompact(workerTokens) : null

  const { badgeText, nameText } = splitWorkerLabel(workerLabel)
  const iconText = workerPresentation?.icon ? `${workerPresentation.icon} ` : ''
  const timerText = workerTimer ? ` · ${workerResumed ? '↺ ' : ''}${workerTimer}` : ''
  const layout = pickAssigneeLayout({
    agentIdWidth,
    iconWidth: iconText.length,
    badgeText,
    nameText,
    modelText: modelDisplayName ?? '',
    timerWidth: timerText.length,
    tokensWidth: tokensLabel ? ` · ${tokensLabel}`.length : 0,
  })
  const displayedName = layout.nameMaxWidth < nameText.length
    ? truncate(nameText, layout.nameMaxWidth)
    : nameText

  return (
    <box style={{ flexDirection: 'row', height: 1, minHeight: 1, maxHeight: 1 }}>
      <box style={{ width: taskNameWidth, minWidth: taskNameWidth, maxWidth: taskNameWidth, flexShrink: 0, flexDirection: 'row' }}>
        <TaskNameContent task={task} effectiveStatus={effectiveStatus} taskNameWidth={taskNameWidth} theme={theme} />
      </box>
      <box style={{ width: columnGap, minWidth: columnGap, maxWidth: columnGap, flexShrink: 0 }} />
      {workerPresentation && workerLabel ? (
        <box style={{ width: agentIdWidth, minWidth: agentIdWidth, maxWidth: agentIdWidth, flexShrink: 0, flexDirection: 'row' }}>
          {canOpenWorkerFork ? (
            <Button
              onClick={() => pushForkOverlay(workerPresentation.interactiveForkId!)}
              onMouseOver={() => onHover(task.taskId)}
              onMouseOut={() => onHoverEnd()}
            >
              <text style={{ fg: workerPresentation.labelColor }}>
                <span fg={workerPresentation.iconColor}>{iconText}</span>
                {layout.showBadge && badgeText ? <span fg={workerPresentation.labelColor}>{`${badgeText} `}</span> : null}
                <span fg={workerPresentation.labelColor}>{displayedName}</span>
              </text>
            </Button>
          ) : (
            <text style={{ fg: workerPresentation.labelColor }}>
              <span fg={workerPresentation.iconColor}>{iconText}</span>
              {layout.showBadge && badgeText ? <span fg={workerPresentation.labelColor}>{`${badgeText} `}</span> : null}
              <span fg={workerPresentation.labelColor}>{displayedName}</span>
            </text>
          )}
          {layout.showModel && modelDisplayName ? (
            <text style={{ fg: theme.muted }}>{` · ${modelDisplayName}`}</text>
          ) : null}
          {workerTimer ? (
            <text style={{ fg: workerPresentation.timerColor }}>
              <span fg={workerPresentation.timerColor}>{' · '}</span>
              {workerResumed ? <span fg={workerPresentation.timerColor}>↺ </span> : null}
              <span fg={workerPresentation.timerColor}>{workerTimer}</span>
            </text>
          ) : null}
          {layout.showTokens && tokensLabel ? (
            <text style={{ fg: theme.muted }}>{` · ${tokensLabel}`}</text>
          ) : null}
        </box>
      ) : null}
    </box>
  )
}

export function TaskList({
  tasks,
  pushForkOverlay,
  roleProfiles,
  subscribeForkCompaction,
  subscribeForkWindow,
  scrollRefOverride,
}: Props) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [expandHovered, setExpandHovered] = useState(false)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const taskScrollRef = useRef<any>(null)

  const box = useLocalWidth()
  const usableWidth = Math.max(1, (box.width ?? 60) - 4)
  const columnGap = 2
  const contentWidth = Math.max(14, usableWidth - columnGap)
  const agentIdWidth = Math.max(12, Math.floor(contentWidth * 0.55))
  const taskNameWidth = Math.max(1, contentWidth - agentIdWidth)

  const visibleAllTasks = tasks
  const realTasksOnly = useMemo(
    () => visibleAllTasks,
    [visibleAllTasks]
  )

  const effectiveVisualStates = useMemo(() => computeInheritedVisualStatusMap(realTasksOnly), [realTasksOnly])
  const rootSummaries = useMemo(() => buildRootSummaries(realTasksOnly), [realTasksOnly])

  const needsFastTick = useMemo(
    () => visibleAllTasks.some(task => (
      task.assignee.kind === 'ghost'
      || (
        task.assignee.kind === 'worker'
        && (task.assignee.variant === 'working' || task.assignee.variant === 'spawning')
      )
    )),
    [visibleAllTasks]
  )

  useEffect(() => {
    if (tasks.length === 0) return
    const tickMs = needsFastTick ? 200 : 1000
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(interval)
  }, [needsFastTick, tasks.length])

  const handleHoverEnd = useCallback(() => setHoveredTaskId(null), [])
  const snapExpandedToBottom = useCallback(() => {
    const scrollTarget = scrollRefOverride?.current ?? taskScrollRef.current
    scrollTarget?.scrollTo(Number.MAX_SAFE_INTEGER)
  }, [scrollRefOverride])
  const visibleTasks = getVisibleTasks(visibleAllTasks, expanded)
  const completedCount = realTasksOnly.filter(task => task.status === 'completed').length
  const activeCount = realTasksOnly.filter(task => task.status !== 'completed').length

  const stickyRootSummary = useMemo(() => {
    if (expanded) return null

    const collapsedTasks = visibleTasks
    if (collapsedTasks.length === 0) return null
    const firstRealCollapsedTask = collapsedTasks[0]
    if (!firstRealCollapsedTask) return null
    const firstIdx = realTasksOnly.findIndex(t => t.taskId === firstRealCollapsedTask.taskId)
    if (firstIdx < 0) return null
    const rootIdx = findOwningRootIndex(realTasksOnly, firstIdx)
    if (rootIdx === null) return null
    const rootTask = realTasksOnly[rootIdx]
    if (!rootTask || collapsedTasks.some(t => t.taskId === rootTask.taskId)) return null
    return rootSummaries.find((root) => root.task.taskId === rootTask.taskId) ?? null
  }, [expanded, rootSummaries, realTasksOnly, visibleTasks])

  useEffect(() => {
    if (!expanded) return
    return scheduleInitialTaskListSnap(snapExpandedToBottom)
  }, [expanded, snapExpandedToBottom])

  useEffect(() => {
    if (!expanded) return
    snapExpandedToBottom()
  }, [expanded, tasks.length, snapExpandedToBottom])

  if (visibleAllTasks.length === 0) return null

  return (
    <box
      ref={box.ref}
      onSizeChange={box.onSizeChange}
      style={{ flexDirection: 'column', flexShrink: 0, borderStyle: 'single', border: ['left', 'right', 'top', 'bottom'], borderColor: slate[500], customBorderChars: BOX_CHARS, backgroundColor: 'transparent', paddingLeft: 1, paddingRight: 1 }}
    >
      {stickyRootSummary && stickyRootSummary.task.kind === 'task' ? (
        <box style={{ flexDirection: 'row', height: 1, minHeight: 1, maxHeight: 1 }}>
          <box style={{ width: taskNameWidth, minWidth: taskNameWidth, maxWidth: taskNameWidth, flexShrink: 0, flexDirection: 'row' }}>
            {(() => {
              const stickyTask = stickyRootSummary.task
              const countsStr = ` (${stickyRootSummary.completed} completed, ${stickyRootSummary.active} active)`
              return <>
                <TaskNameContent task={stickyTask} effectiveStatus={effectiveVisualStates.get(stickyTask.taskId) ?? 'pending'} taskNameWidth={taskNameWidth - countsStr.length} theme={theme} />
                <text style={{ fg: theme.muted }}>{countsStr}</text>
              </>
            })()}
          </box>
          <box style={{ width: columnGap, minWidth: columnGap, maxWidth: columnGap, flexShrink: 0 }} />
          <box style={{ width: agentIdWidth, minWidth: agentIdWidth, maxWidth: agentIdWidth, flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
            {(() => {
              const stickyAssignee = stickyRootSummary.task.assignee
              const stickyRole = stickyAssignee.kind === 'worker' && 'role' in stickyAssignee ? stickyAssignee.role : null
              const stickyModel = stickyRole && isRoleId(stickyRole) ? (roleProfiles?.[stickyRole]?.modelDisplayName ?? null) : null
              const labelText = getAssigneeLabel(stickyAssignee)
              const expandWidth = (expanded ? 'Collapse all ▼  ' : 'Expand all ▲  ').length
              const availableWidth = Math.max(0, agentIdWidth - expandWidth)
              const modelSuffix = stickyModel ? ` · ${stickyModel}` : ''
              const showModel = stickyModel != null && labelText.length + modelSuffix.length <= availableWidth
              const labelDisplay = truncate(labelText, Math.max(1, showModel ? availableWidth - modelSuffix.length : availableWidth))
              return (
                <text style={{ fg: theme.muted }}>
                  <span fg={theme.muted}>{labelDisplay}</span>
                  {showModel ? <span fg={theme.muted}>{modelSuffix}</span> : null}
                </text>
              )
            })()}
            <Button onClick={() => setExpanded(prev => !prev)} onMouseOver={() => setExpandHovered(true)} onMouseOut={() => setExpandHovered(false)}>
              <text style={{ fg: expandHovered ? theme.foreground : theme.muted }}>{expanded ? 'Collapse all ▼  ' : 'Expand all ▲  '}</text>
            </Button>
          </box>
        </box>
      ) : (
        <box style={{ flexDirection: 'row', height: 1, minHeight: 1, maxHeight: 1 }}>
          <box style={{ width: taskNameWidth, minWidth: taskNameWidth, maxWidth: taskNameWidth, flexShrink: 0, flexDirection: 'row' }}>
            <text style={{ fg: theme.foreground }} attributes={TextAttributes.BOLD}>Task</text>
            <text style={{ fg: theme.muted }}>{` (${completedCount} completed, ${activeCount} active)`}</text>
          </box>
          <box style={{ width: columnGap, minWidth: columnGap, maxWidth: columnGap, flexShrink: 0 }} />
          <box style={{ width: agentIdWidth, minWidth: agentIdWidth, maxWidth: agentIdWidth, flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
            <text style={{ fg: theme.foreground }} attributes={TextAttributes.BOLD}>Assigned To</text>
            <Button onClick={() => setExpanded(prev => !prev)} onMouseOver={() => setExpandHovered(true)} onMouseOut={() => setExpandHovered(false)}>
              <text style={{ fg: expandHovered ? theme.foreground : theme.muted }}>{expanded ? 'Collapse all ▼  ' : 'Expand all ▲  '}</text>
            </Button>
          </box>
        </box>
      )}

      {expanded ? (
        <scrollbox
          ref={taskScrollRef}
          stickyScroll
          stickyStart="bottom"
          scrollX={false}
          scrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{ visible: true, trackOptions: { width: 1 } }}
          style={{
            flexShrink: 0,
            rootOptions: {
              height: EXPANDED_ROWS,
              flexShrink: 0,
              backgroundColor: 'transparent',
            },
            wrapperOptions: {
              border: false,
              backgroundColor: 'transparent',
            },
            contentOptions: {
              flexDirection: 'column',
            },
          }}
        >
          {visibleTasks.map(task => (
            <TaskRow
              key={task.rowId}
              task={task}
              effectiveStatus={effectiveVisualStates.get(task.taskId) ?? 'pending'}
              pushForkOverlay={pushForkOverlay}
              hovered={hoveredTaskId === task.taskId}
              onHover={setHoveredTaskId}
              onHoverEnd={handleHoverEnd}
              now={now}
              taskNameWidth={taskNameWidth}
              columnGap={columnGap}
              agentIdWidth={agentIdWidth}
              roleProfiles={roleProfiles}
              subscribeForkCompaction={subscribeForkCompaction}
              subscribeForkWindow={subscribeForkWindow}
            />
          ))}
        </scrollbox>
      ) : (
        <box style={{ flexDirection: 'column' }}>
          {visibleTasks.map(task => (
            <TaskRow
              key={task.rowId}
              task={task}
              effectiveStatus={effectiveVisualStates.get(task.taskId) ?? 'pending'}
              pushForkOverlay={pushForkOverlay}
              hovered={hoveredTaskId === task.taskId}
              onHover={setHoveredTaskId}
              onHoverEnd={handleHoverEnd}
              now={now}
              taskNameWidth={taskNameWidth}
              columnGap={columnGap}
              agentIdWidth={agentIdWidth}
              roleProfiles={roleProfiles}
              subscribeForkCompaction={subscribeForkCompaction}
              subscribeForkWindow={subscribeForkWindow}
            />
          ))}
        </box>
      )}
    </box>
  )
}