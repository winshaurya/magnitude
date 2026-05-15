import { definePrompt } from '../prompt'
import { denyForbiddenCommands, denyMutatingGit, denyWritesOutside, denyMassDestructiveIn, allowAll } from '../policy'
import type { RoleDefinition } from '../types'
import criticPromptRaw from '../prompts/critic.txt' with { type: 'text' }
import { homedir } from 'node:os'
import { join } from 'node:path'

export function createCriticRole(): RoleDefinition {
  return {
    id: 'critic',
    description: 'Reviews code for quality',
    prompt: definePrompt<'SKILLS_SECTION'>(criticPromptRaw),
    defaultRecipient: 'parent',
    agentKind: 'worker',
    spawnable: true,
    policy: [
      denyForbiddenCommands(),
      denyMutatingGit(),
      denyWritesOutside(ctx => [ctx.cwd, ctx.scratchpadPath, join(homedir(), '.magnitude')]),
      denyMassDestructiveIn(ctx => [join(homedir(), '.magnitude')]),
      allowAll(),
    ],
    lifecycle: {
      parentOnSpawn: undefined,
      parentOnIdle: "Review the critic's findings and address any issues identified.",
    },
    initialContext: { parentConversation: true },
  }
}
