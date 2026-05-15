import { describe, expect, test } from 'vitest'
import { YIELD_USER } from '@magnitudedev/xml-act'
import type { UserPart } from '@magnitudedev/ai'
import type { TimelineEntry } from '../types'
import { renderTimeline } from '../render'
import type { AgentInfo } from '../../../projections/agent-status'
import {
  WORKER_PROGRESS_USER_MESSAGE_REMINDER,
} from '../../../prompts/lead-communication-reminders'

const noAgents = { agents: new Map<string, AgentInfo>() }

function makeAgent(status: AgentInfo['status']): AgentInfo {
  return {
    agentId: 'test',
    forkId: 'fork-1',
    parentForkId: null,
    name: 'Test Agent',
    role: 'engineer' as any,
    context: '',
    mode: 'spawn',
    taskId: 't1',
    message: null,
    status,
  }
}

const TS0 = 1711641600000 // 2024-03-28 16:00:00 UTC
const TS1 = TS0 + 30_000
const TS2 = TS0 + 60_000
const TS3 = TS0 + 120_000

describe('renderTimeline', () => {
  test('returns empty array for empty input', () => {
    expect(renderTimeline({ timeline: [], timezone: 'UTC', agentStatus: noAgents })).toEqual([])
  })

  test('timeline-only single user message includes marker and user reply reminder', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'hello', attachments: [] },
    ]
    expect(renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })).toEqual([
      {
        _tag: 'TextPart',
        text:
          `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">hello</magnitude:message>`,
      },
    ])
  })

  test('timeline-only single user message with attachments renders attachments', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'user_message',
        timestamp: TS0,
        text: 'hello',
        attachments: [
          {
            kind: 'mention',
            path: 'src/a.ts',
            contentType: 'text',
            content: 'export const a = 1',
            truncated: true,
            originalBytes: 42,
          },
          { kind: 'image', image: { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } } },
        ],
      },
    ]

    expect(renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })).toEqual([
      {
        _tag: 'TextPart',
        text: '--- 2024-03-28 16:00 ---\n<magnitude:message from="user">hello</magnitude:message>\n<mention path="src/a.ts" type="text" truncated="true" original_bytes="42">export const a = 1</mention>',
      },
      { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } },
    ])
  })

  test('timeline with multiple entries adds time markers', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'a', attachments: [] },
      { kind: 'user_message', timestamp: TS2, text: 'b', attachments: [] },
    ]
    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">a</magnitude:message>\n\n--- 16:01 ---\n<magnitude:message from="user">b</magnitude:message>`,
      },
    ])
  })

  test('preserves timeline input order', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS2, text: 'second', attachments: [] },
      { kind: 'user_message', timestamp: TS0, text: 'first', attachments: [] },
    ]
    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out[0]).toEqual({
      _tag: 'TextPart',
      text:
        `--- 2024-03-28 16:01 ---\n<magnitude:message from="user">second</magnitude:message>\n\n--- 16:00 ---\n<magnitude:message from="user">first</magnitude:message>`,
    })
  })

  test('renders user message attachments (mentions and images)', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'user_message',
        timestamp: TS0,
        text: 'see this',
        attachments: [
          {
            kind: 'mention',
            path: 'b.ts',
            contentType: 'text',
            content: 'const x = 1', truncated: true, originalBytes: 123,
          },
          { kind: 'mention', path: 'c.ts', contentType: 'text', error: 'not found' },
          { kind: 'image', image: { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } } },
        ],
      },
      { kind: 'lifecycle_hook', timestamp: TS1, agentId: 'builder-z', role: 'engineer', hookType: 'spawn' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '--- 2024-03-28 16:00 ---\n<magnitude:message from="user">see this</magnitude:message>\n<mention path="b.ts" type="text" truncated="true" original_bytes="123">const x = 1</mention>\n<mention path="c.ts" type="text" error="not found"/>',
      },
      { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } },
    ])
  })

  test('formats task worker spawn reminder with role, task id, and title', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'lifecycle_hook',
        timestamp: TS1,
        agentId: 'agent-debug-1',
        role: 'debugger',
        hookType: 'spawn',
        taskId: 'diag-1',
        taskTitle: 'Investigate the crash',
      },
    ]
    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([])
  })

  test('equal timestamp entries preserve input order', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'first-input', attachments: [] },
      { kind: 'user_message', timestamp: TS0, text: 'second-input', attachments: [] },
    ]
    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out[0]).toEqual({
      _tag: 'TextPart',
      text:
        `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">first-input</magnitude:message>\n<magnitude:message from="user">second-input</magnitude:message>`,
    })
  })

  test('adds attention bullets for user messages and idle agents only when not last', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'hi', attachments: [] },
      {
        kind: 'agent_block',
        timestamp: TS1,
        firstAtomTimestamp: TS1,
        lastAtomTimestamp: TS1,
        agentId: 'builder-a',
        role: 'engineer',
        atoms: [{ kind: 'idle', timestamp: TS1 }],
      },
      { kind: 'lifecycle_hook', timestamp: TS2, agentId: 'builder-a', role: 'engineer', hookType: 'idle' },
    ]

    const out = renderTimeline({
      timeline,
      timezone: 'UTC',
      agentStatus: { agents: new Map([['builder-a', makeAgent('idle')]]) },
    })
    expect(out[0]).toEqual({
      _tag: 'TextPart',
      text:
        `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">hi</magnitude:message>\n<agent id="builder-a" role="engineer" status="idle">\n${YIELD_USER}\n</agent>\n\n<attention>\n- user message at 16:00\n- builder-a went idle at 16:00\n</attention>`,
    })
  })

  test('passes through observation image UserParts', () => {
    const img: UserPart = { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png' }
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'observation',
        timestamp: TS0,
        parts: [{ _tag: 'TextPart', text: 'seen' }, img],
      },
      { kind: 'lifecycle_hook', timestamp: TS2, agentId: 'builder-a', role: 'engineer', hookType: 'spawn' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text: '--- 2024-03-28 16:00 ---\nseen',
      },
      img,
    ])
  })

  test('renders task updates block with expected lines', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'task_update', timestamp: TS0, action: 'created', taskId: 't1', title: 'Title' },
      { kind: 'task_update', timestamp: TS1, action: 'status_changed', taskId: 't1', previousStatus: 'pending', nextStatus: 'completed' },
      { kind: 'task_update', timestamp: TS2, action: 'completed', taskId: 't1' },
      { kind: 'task_update', timestamp: TS3 + 1, action: 'cancelled', taskId: 't2', cancelledCount: 3 },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '<task_updates>\n- Task t1 created: "Title"\n- Task t1 status changed: pending -> completed\n- Task t1 completed\n- Task t2 cancelled (3 tasks removed)\n</task_updates>',
      },
    ])
  })

  test('renders task updates adjacent to task tree', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'task_update', timestamp: TS0, action: 'cancelled', taskId: 't1', cancelledCount: 2 },
      { kind: 'task_tree_view', timestamp: TS1, renderedTree: '- [ ] t3 next' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '<task_updates>\n- Task t1 cancelled (2 tasks removed)\n</task_updates>\n\n<task_tree>\n- [ ] t3 next\n</task_tree>',
      },
    ])
  })

  test('does not include task_update entries in chronological stream', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'task_update', timestamp: TS0, action: 'created', taskId: 't1', title: 'Title' },
      { kind: 'user_message', timestamp: TS1, text: 'hello', attachments: [] },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">hello</magnitude:message>\n\n<task_updates>\n- Task t1 created: "Title"\n</task_updates>`,
      },
    ])
  })

  test('renders agent_block atoms (thought, tool_call, message, idle, error)', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'agent_block',
        timestamp: TS0,
        firstAtomTimestamp: TS0,
        lastAtomTimestamp: TS3,
        agentId: 'builder-x',
        role: 'engineer',
        atoms: [
          { kind: 'thought', timestamp: TS0, text: 'thinking' },
          {
            kind: 'tool_call',
            timestamp: TS1,
            toolCallId: 'tc1',
            toolName: 'read',
            attributes: { path: 'src/a.ts' },
            status: 'success',
          },
          { kind: 'message', timestamp: TS2, direction: 'to_lead', text: 'done?' },
          { kind: 'error', timestamp: TS2, message: 'oops' },
          { kind: 'idle', timestamp: TS3, reason: 'error' },
        ],
      },
      { kind: 'lifecycle_hook', timestamp: TS3 + 1, agentId: 'builder-x', role: 'engineer', hookType: 'idle' },
    ]

    const out = renderTimeline({
      timeline,
      timezone: 'UTC',
      agentStatus: { agents: new Map([['builder-x', makeAgent('idle')]]) },
    })
    expect(out[0]).toEqual({
      _tag: 'TextPart',
      text:
        `--- 2024-03-28 16:00 ---\n<agent id="builder-x" role="engineer" status="idle">\nthinking\n<read path="src/a.ts"/>\n<magnitude:message to="lead">done?</magnitude:message>\n<error>oops</error>\n${YIELD_USER}\n</agent>\n\n<reminders>\n- ${WORKER_PROGRESS_USER_MESSAGE_REMINDER}\n</reminders>\n\n<attention>\n- builder-x errored at 16:00\n</attention>`,
    })
  })

  test('renders user_bash_command timeline entry', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'user_bash_command',
        timestamp: TS0,
        command: 'ls -la',
        cwd: '/tmp',
        exitCode: 0,
        stdout: 'file-a',
        stderr: '',
      },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '--- 2024-03-28 16:00 ---\n<user_bash_command cwd="/tmp" exit_code="0">\n<command>ls -la</command>\n<stdout>file-a</stdout>\n<stderr></stderr>\n</user_bash_command>',
      },
    ])
  })

  test('renders all non-observation timeline kinds', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'u', attachments: [] },
      { kind: 'user_to_agent', timestamp: TS1, agentId: 'a1', text: 'direct' },
      {
        kind: 'subagent_user_killed',
        timestamp: TS1,
        agentId: 'a2',
        agentType: 'builder',
      },
      { kind: 'user_presence', timestamp: TS1, text: 'back', confirmed: true },

      { kind: 'lifecycle_hook', timestamp: TS2, agentId: 'builder-z', role: 'engineer', hookType: 'spawn' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    const text = out[0]
    expect(text).toEqual({
      _tag: 'TextPart',
      text:
        `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">u</magnitude:message>\n<user-to-agent agent="a1">direct</user-to-agent>\n<subagent-user-killed agent="a2" type="builder"/>\n<user-presence confirmed="true">back</user-presence>`,
    })
  })

  test('does not render user reply reminder when no user_message is present', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'parent_message', timestamp: TS0, text: 'from parent' },
      { kind: 'lifecycle_hook', timestamp: TS1, agentId: 'builder-z', role: 'engineer', hookType: 'spawn' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '--- 2024-03-28 16:00 ---\n<magnitude:message from="parent">from parent</magnitude:message>',
      },
    ])
  })

  test('does not render worker progress reminder for agent_block without to_lead message atom', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'agent_block',
        timestamp: TS0,
        firstAtomTimestamp: TS0,
        lastAtomTimestamp: TS2,
        agentId: 'builder-x',
        role: 'engineer',
        atoms: [
          { kind: 'thought', timestamp: TS0, text: 'thinking' },
          {
            kind: 'tool_call',
            timestamp: TS1,
            toolCallId: 'tc1',
            toolName: 'read',
            attributes: { path: 'src/a.ts' },
            status: 'success',
          },
          { kind: 'error', timestamp: TS2, message: 'oops' },
        ],
      },
      { kind: 'lifecycle_hook', timestamp: TS3, agentId: 'builder-x', role: 'engineer', hookType: 'idle' },
    ]

    const out = renderTimeline({
      timeline,
      timezone: 'UTC',
      agentStatus: { agents: new Map([['builder-x', makeAgent('working')]]) },
    })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '--- 2024-03-28 16:00 ---\n<agent id="builder-x" role="engineer" status="working">\nthinking\n<read path="src/a.ts"/>\n<error>oops</error>\n</agent>\n\n<attention>\n- builder-x errored at 16:00\n</attention>',
      },
    ])
  })

  test('does not render worker progress reminder for lifecycle_hook/task_idle_hook alone', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'lifecycle_hook', timestamp: TS0, agentId: 'builder-z', role: 'engineer', hookType: 'spawn' },
      { kind: 'task_idle_hook', timestamp: TS1, taskId: 't1', title: 'Build thing', agentId: 'builder-z' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          '<reminders>\n- Worker builder-z for task t1 ("Build thing") has finished. Review output and either send feedback or mark complete.\n</reminders>',
      },
    ])
  })

  test('renders both communication reminders together when user and worker messages are present', () => {
    const timeline: readonly TimelineEntry[] = [
      { kind: 'user_message', timestamp: TS0, text: 'hello', attachments: [] },
      {
        kind: 'agent_block',
        timestamp: TS1,
        firstAtomTimestamp: TS1,
        lastAtomTimestamp: TS1,
        agentId: 'builder-x',
        role: 'engineer',
        atoms: [{ kind: 'message', timestamp: TS1, direction: 'to_lead', text: 'progress update' }],
      },
    ]

    const out = renderTimeline({
      timeline,
      timezone: 'UTC',
      agentStatus: { agents: new Map([['builder-x', makeAgent('working')]]) },
    })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text:
          `--- 2024-03-28 16:00 ---\n<magnitude:message from="user">hello</magnitude:message>\n<agent id="builder-x" role="engineer" status="working">\n<magnitude:message to="lead">progress update</magnitude:message>\n</agent>\n\n<reminders>\n- ${WORKER_PROGRESS_USER_MESSAGE_REMINDER}\n</reminders>`,
      },
    ])
  })


  test('always passes through image attachments', () => {
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'user_message',
        timestamp: TS0,
        text: 'look at this',
        attachments: [
          { kind: 'image', image: { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } }, filename: 'screenshot.png' },
        ],
      },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text: `--- 2024-03-28 16:00 ---
<magnitude\u003amessage from="user">look at this</magnitude\u003amessage>`,
      },
      { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png', dimensions: { width: 100, height: 100 } },
    ])
  })

  test('always passes through observation images', () => {
    const img: UserPart = { _tag: 'ImagePart', data: 'abc', mediaType: 'image/png' }
    const timeline: readonly TimelineEntry[] = [
      {
        kind: 'observation',
        timestamp: TS0,
        parts: [{ _tag: 'TextPart', text: 'seen' }, img],
      },
      { kind: 'lifecycle_hook', timestamp: TS2, agentId: 'builder-a', role: 'engineer', hookType: 'spawn' },
    ]

    const out = renderTimeline({ timeline, timezone: 'UTC', agentStatus: noAgents })
    expect(out).toEqual([
      {
        _tag: 'TextPart',
        text: '--- 2024-03-28 16:00 ---\nseen',
      },
      img,
    ])
  })
})
