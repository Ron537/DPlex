import type { Project, AISession, EditorGroup } from '../../types'

/** Settings tab identifier. Mirrors the `SettingsTab` union used inside
 *  `SettingsModal`. Kept here so the search registry doesn't have to import
 *  from a UI component. */
export type SettingsTab =
  | 'appearance'
  | 'terminal'
  | 'ai-tools'
  | 'notifications'
  | 'worktrees'
  | 'shortcuts'
  | 'about'

/** Categories surfaced in the global search UI. Order here drives the
 *  default render order in the grouped result list. */
export type SearchCategory = 'projects' | 'sessions' | 'tabs' | 'settings' | 'commands'

export const CATEGORY_LABELS: Record<SearchCategory, string> = {
  projects: 'Projects',
  sessions: 'Sessions',
  tabs: 'Open Tabs',
  settings: 'Settings',
  commands: 'Commands'
}

export const CATEGORY_ORDER: SearchCategory[] = [
  'commands',
  'projects',
  'sessions',
  'tabs',
  'settings'
]

/** Span of consecutive matched character indices (inclusive start, exclusive
 *  end) within a label. Produced by `fuzzyMatch` and used by the UI to
 *  render highlighted runs. */
export interface MatchRange {
  start: number
  end: number
}

/** A renderable, runnable item produced by a search source. */
export interface SearchItem {
  /** Stable id, unique across all sources. Used as React key + aria-id. */
  id: string
  category: SearchCategory
  /** Primary label that the matcher scores against. */
  label: string
  /** Optional secondary line (path, branch, etc.). Not scored. */
  description?: string
  /** Optional trailing badge text (e.g. shortcut, provider name). */
  hint?: string
  /** Optional keywords that the matcher considers in addition to `label`.
   *  Used to make settings findable by synonyms (e.g. "color" → theme). */
  keywords?: string[]
  /** Action invoked when the user picks this item. May be async. */
  run: () => void | Promise<void>
}

/** Pure snapshot of the renderer state passed into each source.
 *  Sources read from this snapshot only — they never call `useStore.getState`
 *  directly so they stay easy to unit-test. */
export interface SearchContext {
  projects: Project[]
  sessions: AISession[]
  groups: EditorGroup[]
  activeGroupId: string | null
}

/** A search source contributes items for a single category. */
export interface SearchSource {
  category: SearchCategory
  /** Returns the unfiltered set of items. The registry runs the matcher
   *  on top — sources never run the matcher themselves. */
  getItems: (ctx: SearchContext) => SearchItem[]
}

/** Result of a ranked match for one item. */
export interface RankedItem {
  item: SearchItem
  score: number
  ranges: MatchRange[]
}

/** Result group returned by `runSearch`. */
export interface SearchResultGroup {
  category: SearchCategory
  label: string
  items: RankedItem[]
}
