import type { ProjectActivity } from '../hooks/useProjectSessions'

/**
 * Visual status for a project row in the panel.
 * - `live`: at least one active AI session. Green accent rail + pulse dot.
 * - `idle`: nothing running. No rail, subtle border.
 *
 * NOTE: Consistent with `ProjectActivity.hasActive` — "live" follows active
 * AI sessions, not merely open terminals. Open terminals alone do not signal
 * a project is actively working on something.
 */
export type ProjectStatus = 'live' | 'idle'

export function getProjectStatus(activity: ProjectActivity): ProjectStatus {
  return activity.hasActive ? 'live' : 'idle'
}

/**
 * Rail accent style for each status.
 *
 * - `live` + expanded → bright gradient (full status signal).
 * - Otherwise → a muted neutral track so every origin row has a consistent
 *   visual gutter. `--dplex-text-muted` renders as a visible subtle gray on
 *   every theme, unlike `--dplex-border` which often blends into the panel.
 *
 * A rail always renders on origin rows; colour conveys the state.
 */
export function getRailBackground(status: ProjectStatus, isExpanded: boolean): string {
  if (status === 'live' && isExpanded) {
    return 'linear-gradient(to bottom, var(--dplex-status-active), var(--dplex-accent))'
  }
  return 'var(--dplex-text-muted)'
}

/**
 * Palette for rich-mode avatars. Picked to be legible on light + dark themes.
 * Each entry is a [background-rgba, foreground-hex] pair — background uses
 * alpha so it tints nicely against any panel color.
 */
const AVATAR_PALETTE: Array<[string, string]> = [
  ['rgba(124,156,255,0.18)', '#7c9cff'],
  ['rgba(139,92,246,0.18)', '#a78bfa'],
  ['rgba(60,207,145,0.18)', '#3ccf91'],
  ['rgba(240,179,90,0.18)', '#f0b35a'],
  ['rgba(239,106,106,0.18)', '#ef6a6a'],
  ['rgba(93,209,206,0.18)', '#5dd1ce'],
  ['rgba(236,112,176,0.18)', '#ec70b0'],
  ['rgba(176,196,120,0.18)', '#b0c478']
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/**
 * Deterministic avatar color derived from a stable project identity.
 * Hashing the project id (not the name) keeps colors stable across renames
 * and prevents name collisions across unrelated repos.
 */
export function getAvatarColor(projectId: string): { bg: string; fg: string } {
  const [bg, fg] = AVATAR_PALETTE[hashString(projectId) % AVATAR_PALETTE.length]
  return { bg, fg }
}

/**
 * Pick up to 2 initials from a project name for the avatar glyph.
 * Handles dot-separated (`InE.AlertsApi` → `IA`), snake/kebab/camel, and
 * plain names. Always upper-cased.
 */
export function getAvatarInitials(name: string): string {
  if (!name) return '?'
  const cleaned = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  const single = parts[0] ?? name
  // Split camelCase / PascalCase
  const camelParts = single.split(/(?=[A-Z])/).filter(Boolean)
  if (camelParts.length >= 2) {
    return (camelParts[0][0] + camelParts[1][0]).toUpperCase()
  }
  return single.slice(0, 2).toUpperCase()
}
