import type { ProviderToolCallId, ToolCallId } from '@magnitudedev/ai'
import { createToolHandle as harnessCreateToolHandle, type ToolHandle } from '@magnitudedev/harness'
import type { Toolkit } from '@magnitudedev/harness'

export type { ToolHandle } from '@magnitudedev/harness'

export function createToolHandleFromToolkit(
  toolCallId: ToolCallId,
  providerToolCallId: ProviderToolCallId,
  toolKey: string,
  toolkit: Toolkit,
): ToolHandle | null {
  const entry = toolkit.entries[toolKey]
  if (!entry?.state) return null
  return harnessCreateToolHandle(toolCallId, providerToolCallId, toolKey, entry.state)
}
