import type { AttentionKind } from '../../../../preload/attentionTypes'
import {
  isTerminalTab,
  type Project,
  type Space,
  type TerminalTab,
  type WorkspaceSnapshot
} from '../../types'
import type { SpaceAttention } from '../../utils/spaceAttention'

/** Darken (amt<0) or lighten (amt>0) a hex color by a flat channel offset. */
export function shade(hex: string, amt: number): string {
  let c = hex.replace('#', '')
  if (c.length === 3)
    c = c
      .split('')
      .map((x) => x + x)
      .join('')
  const n = parseInt(c, 16)
  const clamp = (v: number): number => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amt)
  const g = clamp(((n >> 8) & 255) + amt)
  const b = clamp((n & 255) + amt)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

/** Up to two uppercase initials from a space name (for the avatar fallback). */
export function spaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'S'
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** The glyph to render on a space avatar: explicit glyph, else initials. */
export function glyphFor(space: Pick<Space, 'name' | 'glyph'>): string {
  const g = typeof space.glyph === 'string' ? space.glyph.trim() : ''
  return g.length > 0 ? g : spaceInitials(space.name)
}

/** CSS var for an attention kind's color (approval > input > finished). */
export function attentionColorVar(kind: AttentionKind | null): string {
  switch (kind) {
    case 'waitingForApproval':
      return 'var(--dplex-status-approval)'
    case 'waitingForInput':
      return 'var(--dplex-status-waiting)'
    case 'finished':
      return 'var(--dplex-status-success)'
    default:
      return 'var(--dplex-status-idle)'
  }
}

/** Short human label for a space's rolled-up attention, e.g. "3 to review". */
export function attentionLabel(a: SpaceAttention): string {
  if (a.total === 0) return ''
  if (a.waitingForApproval > 0 || a.waitingForInput > 0) {
    const n = a.waitingForApproval + a.waitingForInput
    return `${n} to review`
  }
  return `${a.finished} done`
}

/** All terminal tabs (AI sessions + plain shells) in a workspace snapshot. */
export function terminalTabs(ws: WorkspaceSnapshot): TerminalTab[] {
  const out: TerminalTab[] = []
  for (const g of ws.groups) for (const t of g.tabs) if (isTerminalTab(t)) out.push(t)
  return out
}

/** Count of terminal tabs (AI sessions + shells) in a workspace snapshot. */
export function sessionCount(ws: WorkspaceSnapshot): number {
  return terminalTabs(ws).length
}

/** True when a terminal tab is an AI session (has a resolved provider+session). */
export function isAiSessionTab(t: TerminalTab): boolean {
  return !!(t.providerId && t.sessionId)
}

/** Resolve a space's bound projects to Project objects, in bind order,
 *  dropping any ids that no longer exist. */
export function boundProjects(space: Pick<Space, 'projectIds'>, projects: Project[]): Project[] {
  return space.projectIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => !!p)
}

/** Compact "time ago" label for a space's last-active timestamp. */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return day === 1 ? 'yesterday' : `${day}d ago`
}
