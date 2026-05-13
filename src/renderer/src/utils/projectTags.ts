import type { Project } from '../types'

/** Maximum length of a single normalized tag. Keeps storage bounded and
 *  prevents pathological UI overflow from pasted text. */
export const MAX_TAG_LENGTH = 32

/**
 * Theme-safe palette used by tag pills. Same pattern as `AVATAR_PALETTE` in
 * `projectStatus.ts` — translucent background so the pill tints any panel
 * color cleanly, plus a saturated foreground that reads on both light and
 * dark themes. Each entry's `id` is what gets persisted in `tagColors`.
 *
 * Order is the order shown in the color picker swatch grid; keep it stable
 * because users will memorize positions ("third swatch = my client tag").
 */
export interface TagColorToken {
  id: string
  label: string
  bg: string
  fg: string
}

export const TAG_PALETTE: readonly TagColorToken[] = [
  { id: 'blue', label: 'Blue', bg: 'rgba(124,156,255,0.20)', fg: '#7c9cff' },
  { id: 'violet', label: 'Violet', bg: 'rgba(167,139,250,0.20)', fg: '#a78bfa' },
  { id: 'green', label: 'Green', bg: 'rgba(60,207,145,0.20)', fg: '#3ccf91' },
  { id: 'amber', label: 'Amber', bg: 'rgba(240,179,90,0.22)', fg: '#d9921f' },
  { id: 'red', label: 'Red', bg: 'rgba(239,106,106,0.20)', fg: '#ef6a6a' },
  { id: 'teal', label: 'Teal', bg: 'rgba(93,209,206,0.20)', fg: '#2db8b4' },
  { id: 'pink', label: 'Pink', bg: 'rgba(236,112,176,0.20)', fg: '#ec70b0' },
  { id: 'lime', label: 'Lime', bg: 'rgba(176,196,120,0.22)', fg: '#7c9f30' }
]

const TAG_PALETTE_BY_ID = new Map(TAG_PALETTE.map((c) => [c.id, c]))

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Resolve the rendered colors for a tag.
 *
 * - If the user explicitly chose a palette entry (via the color picker)
 *   `overrideId` will be the palette token id and we return that entry.
 * - Otherwise we deterministically hash the tag name to a palette entry,
 *   so the same tag string always renders with the same colour without
 *   the user having to set one.
 *
 * Unknown override ids (from older builds or hand-edited settings) fall
 * back to the hashed default.
 */
export function getTagColor(tag: string, overrideId?: string | null): TagColorToken {
  if (overrideId) {
    const hit = TAG_PALETTE_BY_ID.get(overrideId)
    if (hit) return hit
  }
  return TAG_PALETTE[hashString(tag) % TAG_PALETTE.length]
}

/**
 * Normalize a single user-typed tag into the canonical stored form.
 *
 * - Strips any leading `#` characters (users can type `#infra` or `infra`).
 * - Replaces whitespace with `-` so multi-word tags survive copy/paste.
 * - Lowercases.
 * - Removes characters outside `[a-z0-9._-]`.
 * - Trims leading/trailing separators.
 * - Truncates to {@link MAX_TAG_LENGTH}.
 *
 * Returns `null` for inputs that normalize to empty — callers should treat
 * `null` as "skip / not a valid tag" rather than storing it.
 */
export function normalizeTag(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim().toLowerCase()
  while (s.startsWith('#')) s = s.slice(1)
  s = s.replace(/\s+/g, '-')
  s = s.replace(/[^a-z0-9._-]/g, '')
  s = s.replace(/^[-._]+|[-._]+$/g, '')
  if (s.length === 0) return null
  if (s.length > MAX_TAG_LENGTH) s = s.slice(0, MAX_TAG_LENGTH)
  return s
}

/**
 * Normalize an arbitrary list of raw tags into a deduped, sorted array of
 * canonical tags. Order is alphabetical so persisted JSON is stable.
 */
export function normalizeTags(raw: readonly string[] | undefined | null): string[] {
  if (!raw || raw.length === 0) return []
  const out = new Set<string>()
  for (const r of raw) {
    const t = normalizeTag(r)
    if (t) out.add(t)
  }
  return [...out].sort()
}

/** Aggregate tag → usage count across the given projects, sorted by count
 *  desc then alphabetical. Used to drive the sidebar filter strip. */
export function collectTagCounts(projects: readonly Project[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of projects) {
    const tags = p.tags
    if (!tags || tags.length === 0) continue
    for (const t of tags) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  const out = [...counts.entries()].map(([tag, count]) => ({ tag, count }))
  out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return out
}

/** True when `project` carries `tag` exactly (already normalized). */
export function projectHasTag(project: Project, tag: string): boolean {
  return Array.isArray(project.tags) && project.tags.includes(tag)
}
