import { TextAttributes } from '@opentui/core';
import type { BaseState } from '@magnitudedev/harness';
import { createToolDisplay } from '../types';
import { Button } from '../../components/button';
import { ShimmerText } from '../../components/shimmer-text';
import { useTheme } from '../../hooks/use-theme';

const SHIMMER_INTERVAL_MS = 160;

export const defaultDisplay = createToolDisplay<BaseState>({
  render: ({ state, isExpanded, onToggle }) => {
    const theme = useTheme();
    const isRunning = state.phase === 'streaming' || state.phase === 'executing';
    const isErrorLike = state.phase === 'error' || state.phase === 'rejected' || state.phase === 'interrupted';

    return (
      <box style={{ flexDirection: 'column' }}>
        <Button onClick={onToggle}>
          <text style={{ wrapMode: 'word' }}>
            <span style={{ fg: isErrorLike ? theme.error : theme.info }}>
              {isErrorLike ? '✗ ' : '• '}
            </span>
            <span style={{ fg: theme.foreground }}>tool</span>
            {isRunning ? (
              <>
                <span>{' '}</span>
                <ShimmerText text="..." interval={SHIMMER_INTERVAL_MS} primaryColor={theme.secondary} />
              </>
            ) : (
              <>
                <span style={{ fg: isErrorLike ? theme.error : theme.success }}>
                  {isErrorLike ? ' · Error' : ' · Done'}
                </span>
                <span style={{ fg: theme.secondary }} attributes={TextAttributes.DIM}>
                  {isExpanded ? ' (collapse)' : ' (expand)'}
                </span>
              </>
            )}
          </text>
        </Button>
      </box>
    );
  },
  summary: (state) => {
    if (state.phase === 'streaming' || state.phase === 'executing') return 'Run tool';
    if (state.phase === 'error') return 'Tool error';
    if (state.phase === 'rejected') return 'Tool rejected';
    if (state.phase === 'interrupted') return 'Tool interrupted';
    return 'Tool done';
  },
});
