import { fuzzyMatchAny } from './fuzzyMatch'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type RankedItem,
  type SearchCategory,
  type SearchContext,
  type SearchResultGroup,
  type SearchSource
} from './types'

/** Maximum results surfaced per category for a given query. */
export const MAX_RESULTS_PER_GROUP = 8

/** Maximum items each source contributes when the query is empty.
 *  Keeps the empty-state list short and predictable. */
const EMPTY_QUERY_LIMIT = 5

export interface RunSearchOptions {
  /** When set, only items in this category are returned (other categories are
   *  pruned entirely). Used by the "commands only" palette mode. */
  categories?: ReadonlyArray<SearchCategory>
  /** Override the per-group cap (mostly useful in tests). */
  maxPerGroup?: number
  /** Override the cap applied when the query is empty. Defaults to a small
   *  preview so the all-categories palette stays scannable; raise this when
   *  the surface is filtered to a single category and the user expects to
   *  see the full list (e.g. the commands runner). */
  emptyQueryLimit?: number
}

/** A registry of search sources. Lazy: sources are evaluated only when
 *  `run()` is called. Pure — no IPC, no global state of its own. */
export class SearchRegistry {
  private readonly sources = new Map<SearchCategory, SearchSource>()

  register(source: SearchSource): void {
    this.sources.set(source.category, source)
  }

  /** Run a query against every registered source and return grouped, ranked
   *  results. Empty categories are dropped. */
  run(query: string, ctx: SearchContext, opts: RunSearchOptions = {}): SearchResultGroup[] {
    const trimmed = query.trim()
    const cap = opts.maxPerGroup ?? MAX_RESULTS_PER_GROUP
    const emptyCap = opts.emptyQueryLimit ?? EMPTY_QUERY_LIMIT
    const allowed = opts.categories ? new Set(opts.categories) : null

    const groups: SearchResultGroup[] = []
    for (const category of CATEGORY_ORDER) {
      if (allowed && !allowed.has(category)) continue
      const source = this.sources.get(category)
      if (!source) continue
      const items = source.getItems(ctx)
      if (items.length === 0) continue

      let ranked: RankedItem[]
      if (trimmed === '') {
        // Empty query: surface a stable preview from each source — small by
        // default, configurable per call.
        ranked = items.slice(0, emptyCap).map((item) => ({
          item,
          score: 0,
          ranges: []
        }))
      } else {
        ranked = []
        for (const item of items) {
          const m = fuzzyMatchAny(item.label, item.keywords, trimmed)
          if (m === null) continue
          ranked.push({ item, score: m.score, ranges: m.ranges })
        }
        ranked.sort((a, b) => b.score - a.score)
        ranked = ranked.slice(0, cap)
      }

      if (ranked.length > 0) {
        groups.push({
          category,
          label: CATEGORY_LABELS[category],
          items: ranked
        })
      }
    }
    return groups
  }
}

/** Helper to build a registry from an array of sources. */
export function buildRegistry(sources: SearchSource[]): SearchRegistry {
  const reg = new SearchRegistry()
  for (const s of sources) reg.register(s)
  return reg
}
