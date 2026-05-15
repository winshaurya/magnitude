import { type ReassignWorkerState } from '@magnitudedev/agent/src/models';
import { createToolDisplay } from '../types';
import { useTheme } from '../../hooks/use-theme';
import { violet } from '../../utils/theme';

export const reassignWorkerDisplay = createToolDisplay<ReassignWorkerState>({
  render: ({ state }) => {
    const theme = useTheme();
    const isCompleted = state.phase === 'completed';
    const isError = state.phase === 'error' || state.phase === 'rejected' || state.phase === 'interrupted';
    const isStreaming = state.phase === 'streaming' || state.phase === 'executing';

    if (isCompleted) {
      return (
        <text>
          <span style={{ fg: violet[300] }}>{'↔ '}</span>
          <span style={{ fg: theme.muted }}>{'Reassign '}</span>
          <span style={{ fg: theme.foreground }}>{state.agentId}</span>
          <span style={{ fg: theme.muted }}>{' → task '}</span>
          <span style={{ fg: theme.foreground }}>{state.taskId}</span>
        </text>
      );
    }

    if (isError) {
      return (
        <text>
          <span style={{ fg: theme.error }}>{'✗ '}</span>
          <span style={{ fg: theme.muted }}>{'Reassign worker'}</span>
          <span style={{ fg: theme.error }}>{' · Error'}</span>
        </text>
      );
    }

    return (
      <text>
        <span style={{ fg: violet[300] }}>{'↔ '}</span>
        <span style={{ fg: theme.muted }}>{'Reassign '}</span>
        {state.agentId && <span style={{ fg: theme.foreground }}>{state.agentId}</span>}
        {!state.agentId && state.taskId && <span style={{ fg: theme.muted }}>{'worker'}</span>}
        {state.taskId && (
          <>
            <span style={{ fg: theme.muted }}>{' → task '}</span>
            <span style={{ fg: theme.foreground }}>{state.taskId}</span>
          </>
        )}
        {isStreaming && <span style={{ fg: theme.muted }}>{'...'}</span>}
      </text>
    );
  },
  summary: (state) => {
    if (state.phase === 'completed') return `Reassign ${state.agentId ?? '?'} → ${state.taskId ?? '?'}`;
    if (state.phase === 'streaming' || state.phase === 'executing') return 'Reassign worker...';
    if (state.phase === 'error') return 'Reassign worker · Error';
    if (state.phase === 'rejected') return 'Reassign worker · Rejected';
    if (state.phase === 'interrupted') return 'Reassign worker · Interrupted';
    return 'Reassign worker';
  },
});
