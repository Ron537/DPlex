import type { Space } from '../types'

/**
 * Accent palette for Spaces — mirrors the interactive mockup. Each Space gets
 * one of these; they drive the switcher avatar, overview cards, activity-bar
 * ring, and status-bar label.
 */
export const SPACE_COLORS = [
  '#22D3EE', // cyan
  '#3B82F6', // blue
  '#34D399', // emerald
  '#F59E0B', // amber
  '#A78BFA', // violet
  '#FB923C', // orange
  '#F472B6', // pink
  '#F87171' // red
] as const

export const DEFAULT_SPACE_COLOR: string = SPACE_COLORS[0]

/**
 * Pick the palette color least used by existing spaces so new spaces stay
 * visually distinct. Ties resolve to the earliest palette entry.
 */
export function pickSpaceColor(existing: Pick<Space, 'color'>[]): string {
  const counts = new Map<string, number>()
  for (const c of SPACE_COLORS) counts.set(c, 0)
  for (const s of existing) {
    if (counts.has(s.color)) counts.set(s.color, (counts.get(s.color) ?? 0) + 1)
  }
  let best: string = SPACE_COLORS[0]
  let bestN = Infinity
  for (const c of SPACE_COLORS) {
    const n = counts.get(c) ?? 0
    if (n < bestN) {
      bestN = n
      best = c
    }
  }
  return best
}
