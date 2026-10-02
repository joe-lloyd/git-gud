// Small display helpers shared by the pull request screens.
import type { BotVerdict, ChecksRollup, StatusState } from '@gitgud/peer-protocol'
import { theme } from './theme'

export function stateColor(s: StatusState | ChecksRollup | 'none'): string {
  switch (s) {
    case 'success': case 'skipped': return theme.green
    case 'failure': case 'error': return theme.red
    case 'warning': return theme.yellow
    case 'pending': return theme.cyan
    default: return theme.textMuted
  }
}

export function checksLabel(c: ChecksRollup): string {
  return c === 'success' ? 'belt ✓' : c === 'failure' ? 'belt ✗' : c === 'pending' ? 'belt …' : c === 'warning' ? 'belt ⚠' : 'no checks'
}

// JEV is advisory: success = leans merge, warning = leans changes.
export function botLabel(b: BotVerdict): string {
  switch (b.state) {
    case 'success': return `${b.name} ✓ merge`
    case 'warning': return `${b.name} ⚠ changes`
    case 'pending': return `${b.name} reviewing…`
    case 'error': case 'failure': return `${b.name} failed`
    case 'none': return `${b.name} —`
    default: return b.name
  }
}

export function age(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(t).toISOString().slice(0, 10)
}

export const FILE_STATUS_LETTER = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C' } as const
