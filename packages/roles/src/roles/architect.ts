import { definePrompt } from '../prompt'
import { denyForbiddenCommands, denyMutatingGit, denyWritesOutside, denyMassDestructiveIn, allowAll } from '../policy'
import type { RoleDefinition } from '../types'
import architectPromptRaw from '../prompts/architect.txt' with { type: 'text' }
import { homedir } from 'node:os'
import { join } from 'node:path'

export function createArchitectRole(): RoleDefinition {
  return {
    id: 'architect',
    description: 'Plans structure and design',
    prompt: definePrompt<'SKILLS_SECTION'>(architectPromptRaw),
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
      parentOnIdle: "Review the architect's plan for completeness and alignment with requirements.",
    },
    initialContext: { parentConversation: true },
  }
}
