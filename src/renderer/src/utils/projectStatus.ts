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
 * Avatar colour for a project. Projects are neutral **grey by default** — a
 * project only takes on colour once the user assigns it a tab colour
 * (`Project.tabColor`), at which point its avatar adopts that hue. Keeping the
 * default neutral means colour in the sidebar always *means something* (the
 * user chose it) rather than being decorative noise.
 *
 * Returns a `{ bg, fg, border }` triple consumed by the avatar components:
 *   - grey default → theme tokens so it reads on light + dark
 *   - coloured → a soft same-hue tint (`bg`), same-hue border, and the colour
 *     itself for the initials.
 */
export function deriveAvatarColor(tabColor?: string): {
  bg: string
  fg: string
  border: string
} {
  if (!tabColor) {
    return {
      bg: 'var(--dplex-bg-elev-2)',
      fg: 'var(--dplex-text-dim)',
      border: 'var(--dplex-border)'
    }
  }
  return {
    bg: `${tabColor}26`,
    fg: tabColor,
    border: `${tabColor}5C`
  }
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
