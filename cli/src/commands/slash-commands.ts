export interface SlashCommandDefinition {
  id: string
  label: string
  description: string
  aliases?: string[]
  source?: 'builtin' | 'skill'
  skillPath?: string
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { id: 'new',      label: 'new',      description: 'Start a new conversation' },
  { id: 'resume',   label: 'resume',   description: 'Resume a previous conversation' },
  { id: 'exit',     label: 'exit',     description: 'Exit Magnitude', aliases: ['quit', 'q'] },
  { id: 'bash',     label: 'bash',     description: 'Enter bash mode' },
  { id: 'init',     label: 'init',     description: 'Generate AGENTS.md for this project' },
  { id: 'settings',      label: 'settings',      description: 'Open settings', aliases: ['s'] },
  { id: 'usage',         label: 'usage',         description: 'View usage limits' },
]

let skillCommands: SlashCommandDefinition[] = []

export function registerSkillCommands(skills: SlashCommandDefinition[]) {
  skillCommands = skills
}

export function getAllCommands(): SlashCommandDefinition[] {
  return [...SLASH_COMMANDS, ...skillCommands]
}
