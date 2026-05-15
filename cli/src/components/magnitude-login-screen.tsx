import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { TextAttributes, type KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useTheme } from '../hooks/use-theme'
import { Button } from './button'
import { SingleLineInput } from './single-line-input'
import { BOX_CHARS } from '../utils/ui-constants'
import { writeTextToClipboard } from '../utils/clipboard'
import { LOGO_LINES } from '../utils/ascii-logo'
import { fetchPublicRoleProfiles, type RoleProfile } from '@magnitudedev/agent'

import type { BorderCharacters } from '@opentui/core'
import type { RoleId } from '@magnitudedev/agent'

const MAGNITUDE_URL = 'https://app.magnitude.dev'

const ROLE_ICONS: Record<RoleId, string> = {
  leader: '★',
  scout: '▸',
  architect: '△',
  engineer: '⚒',
  critic: '✓',
  scientist: '∞',
  artisan: '✦',
  advisor: '◎',
}

const ROLE_ORDER: RoleId[] = [
  'leader', 'architect',
  'scout', 'critic',
  'engineer', 'scientist',
  'artisan', 'advisor',
]

const DOUBLE_BOX: BorderCharacters = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  leftT: '╠',
  rightT: '╣',
  topT: '╦',
  bottomT: '╩',
  cross: '╬',
}

function useCopyFeedback() {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const showCopied = useCallback(() => {
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }, [])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  return { copied, showCopied }
}

function getModelColor(modelDisplayName: string, theme: ReturnType<typeof useTheme>): string {
  const name = modelDisplayName.toLowerCase()
  if (name.includes('glm')) return theme.primary
  if (name.includes('minimax')) return theme.success
  if (name.includes('kimi')) return theme.warning
  return theme.foreground
}

function padEnd(s: string, length: number): string {
  return s + ' '.repeat(Math.max(0, length - s.length))
}

interface MagnitudeLoginScreenProps {
  onSubmit: (key: string) => Promise<void> | void
  onExit: () => void
}

export const MagnitudeLoginScreen = memo(function MagnitudeLoginScreen({
  onSubmit,
  onExit,
}: MagnitudeLoginScreenProps) {
  const theme = useTheme()
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [continueHovered, setContinueHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)
  const [roleProfiles, setRoleProfiles] = useState<Partial<Record<RoleId, RoleProfile>> | null>(null)
  const urlCopy = useCopyFeedback()

  useEffect(() => {
    let cancelled = false
    fetchPublicRoleProfiles().then((profiles) => {
      if (!cancelled) setRoleProfiles(profiles)
    }).catch(() => {
      // Graceful fallback: do nothing, roleProfiles stays null
    })
    return () => { cancelled = true }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (submitting) return
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setError('API key is required')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key')
      setSubmitting(false)
    }
  }, [apiKey, onSubmit, submitting])

  useKeyboard(useCallback((key: KeyEvent) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      key.preventDefault()
      onExit()
      return
    }
    if ((key.name === 'return' || key.name === 'enter') && !key.shift) {
      key.preventDefault()
      handleSubmit()
      return
    }
  }, [onExit, handleSubmit]))

  return (
    <box style={{ flexDirection: 'column', height: '100%' }}>
      {/* Hero row: logo + brand */}
      <box style={{
        flexDirection: 'row',
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        flexShrink: 0,
      }}>
        {/* Left: ASCII logo */}
        <box style={{ flexDirection: 'column' }}>
          {LOGO_LINES.map((line, i) => (
            <text key={i} style={{ fg: theme.primary }}>{line}</text>
          ))}
        </box>

        {/* Right: Brand text + roles table */}
        <box style={{ flexDirection: 'column', paddingLeft: 4, justifyContent: 'flex-start', paddingTop: 1 }}>
          <text style={{ fg: theme.primary }}>
            <span attributes={TextAttributes.BOLD}>MAGNITUDE</span>
          </text>
          <text style={{ fg: theme.foreground }}>
            <span attributes={TextAttributes.BOLD}>The best way to code with open models</span>
          </text>
          <text style={{ fg: theme.muted }}>
            Curated models. Purpose-built harness. Reliable inference.
          </text>

          {/* Roles list (conditional) — inside right column with gap */}
          {roleProfiles && (
            <box style={{
              borderStyle: 'single',
              customBorderChars: BOX_CHARS,
              borderColor: theme.border,
              marginTop: 1,
              paddingLeft: 1,
              paddingRight: 1,
              paddingTop: 1,
              paddingBottom: 1,
              flexShrink: 0,
              alignSelf: 'flex-start',
            }}>
              <box style={{ flexDirection: 'column' }}>
                {/* Build 2-column rows */}
                {Array.from({ length: 4 }).map((_, rowIdx) => {
                  const leftRole = ROLE_ORDER[rowIdx * 2]
                  const rightRole = ROLE_ORDER[rowIdx * 2 + 1]
                  if (!leftRole || !rightRole) return null

                  const leftProfile = roleProfiles[leftRole]
                  const rightProfile = roleProfiles[rightRole]
                  const leftRoleName = leftRole.charAt(0).toUpperCase() + leftRole.slice(1)
                  const rightRoleName = rightRole.charAt(0).toUpperCase() + rightRole.slice(1)

                  const leftModelName = leftProfile?.modelDisplayName ?? '?'
                  const rightModelName = rightProfile?.modelDisplayName ?? '?'

                  const leftModelColor = leftProfile ? getModelColor(leftModelName, theme) : theme.muted
                  const rightModelColor = rightProfile ? getModelColor(rightModelName, theme) : theme.muted

                  return (
                    <box key={rowIdx} style={{ flexDirection: 'row' }}>
                      <text style={{ fg: theme.foreground }}>
                        <span attributes={TextAttributes.BOLD}>
                          {ROLE_ICONS[leftRole]}
                        </span>
                        {' '}
                        {padEnd(leftRoleName, 10)}{' '}
                      </text>
                      <text style={{ fg: leftModelColor }}>
                        {padEnd(leftModelName, 12)}
                      </text>
                      <text>{'  '}</text>
                      <text style={{ fg: theme.foreground }}>
                        <span attributes={TextAttributes.BOLD}>
                          {ROLE_ICONS[rightRole]}
                        </span>
                        {' '}
                        {padEnd(rightRoleName, 10)}{' '}
                      </text>
                      <text style={{ fg: rightModelColor }}>
                        {padEnd(rightModelName, 12)}
                      </text>
                    </box>
                  )
                })}
              </box>
            </box>
          )}
        </box>
      </box>

      {/* Sign-up + API key input */}
      <box style={{
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: roleProfiles ? 1 : 2,
        flexGrow: 1,
        flexDirection: 'column',
      }}>
        <box style={{ paddingBottom: 1, flexDirection: 'row' }}>
          <text style={{ fg: theme.muted }}>Sign up for a free API key → </text>
          <text style={{ fg: theme.primary }}>{MAGNITUDE_URL}</text>
          <text> </text>
          <Button
            onClick={async () => {
              try {
                await writeTextToClipboard(MAGNITUDE_URL)
                urlCopy.showCopied()
              } catch {}
            }}
            onMouseOver={() => setCopyHovered(true)}
            onMouseOut={() => setCopyHovered(false)}
          >
            <text style={{ fg: urlCopy.copied ? theme.success : (copyHovered ? theme.foreground : theme.muted) }}>
              {urlCopy.copied ? '[Copied ✓]' : '[Copy link]'}
            </text>
          </Button>
        </box>

        <box style={{ paddingBottom: 1 }}>
          <text style={{ fg: theme.foreground }}>Paste your API key:</text>
        </box>

        {/* Input field */}
        <box style={{
          borderStyle: 'single',
          borderColor: error ? theme.error : theme.primary,
          paddingLeft: 1,
          paddingRight: 1,
          flexShrink: 0,
          width: 80,
        }}>
          <SingleLineInput
            value={apiKey}
            onChange={(v) => {
              setApiKey(v)
              setError(null)
            }}
            placeholder="Paste API key here"
            focused={true}
          />
        </box>

        {error && (
          <box style={{ paddingTop: 1 }}>
            <text style={{ fg: theme.error }}>{error}</text>
          </box>
        )}

        {/* Continue button */}
        <box style={{ paddingTop: 1, flexDirection: 'row', flexShrink: 0 }}>
          <Button
            onClick={handleSubmit}
            onMouseOver={() => setContinueHovered(true)}
            onMouseOut={() => setContinueHovered(false)}
          >
            <box style={{
              borderStyle: 'single',
              borderColor: continueHovered ? theme.primary : theme.border,
              customBorderChars: BOX_CHARS,
              paddingLeft: 1,
              paddingRight: 1,
            }}>
              <text style={{ fg: continueHovered ? theme.primary : theme.foreground }}>
                {submitting ? 'Saving...' : 'Continue (Enter)'}
              </text>
            </box>
          </Button>
        </box>

        {/* Env-var hint */}
        <box style={{ paddingTop: 2 }}>
          <text style={{ fg: theme.muted }}>
            <span attributes={TextAttributes.DIM}>
              Prefer environment variables? Press Esc to exit, set MAGNITUDE_API_KEY, then relaunch.
            </span>
          </text>
        </box>
      </box>
    </box>
  )
})

export type { MagnitudeLoginScreenProps }
