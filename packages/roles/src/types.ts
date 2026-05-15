import type { ExecuteHookContext, InterceptorDecision } from '@magnitudedev/harness'
import type { Effect } from 'effect'
import type { PromptTemplate } from './prompt'

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export type RoleId = 'leader' | 'scout' | 'architect' | 'engineer' | 'critic' | 'scientist' | 'artisan' | 'advisor'

export const ROLE_IDS: readonly RoleId[] = ['leader', 'scout', 'architect', 'engineer', 'critic', 'scientist', 'artisan', 'advisor'] as const

export function isRoleId(value: string): value is RoleId {
  return (ROLE_IDS as readonly string[]).includes(value)
}

export interface PolicyContext {
  readonly cwd: string
  readonly scratchpadPath: string
  readonly disableShellSafeguards?: boolean
  readonly disableCwdSafeguards?: boolean
}

export type PolicyRule = (ctx: ExecuteHookContext & { policyContext: PolicyContext }) =>
  Effect.Effect<InterceptorDecision | null>

export interface RoleDefinition {
  /** Role identity. */
  readonly id: RoleId

  /** Short human-readable description of this role. */
  readonly description: string

  /** System prompt template. Render with runtime vars (e.g. SKILLS_SECTION) to get final text. */
  readonly prompt: PromptTemplate<'SKILLS_SECTION'>

  /** Where messages go by default ('user' for lead, 'parent' for workers). */
  readonly defaultRecipient: 'user' | 'parent'

  /** Agent kind — lead, worker, or peer. Affects prompt structure and available agent tools. */
  readonly agentKind: 'lead' | 'worker' | 'peer'

  /** Whether this role can be spawned as a worker by the lead. */
  readonly spawnable: boolean

  /** Policy rules — evaluated by the agent to build a beforeExecute hook. */
  readonly policy: PolicyRule[]

  /** Lifecycle prompts shown to parent/user at spawn/completion. */
  readonly lifecycle?: {
    readonly parentOnSpawn?: string
    readonly parentOnIdle?: string
  }

  /** Initial context flags. */
  readonly initialContext: {
    readonly parentConversation: boolean
  }
}
