/**
 * Shared types for the Overview Dashboard.
 *
 * `HistoricalSession` is the lightweight, provider-agnostic row each provider
 * yields from {@link SessionProvider.getSessionHistory}. The aggregator turns a
 * flat list of these into a {@link DashboardMetrics} snapshot. These types flow
 * main → preload → renderer, so they must stay JSON-serializable (no Dates).
 */

/** A single past session, reduced to the fields the dashboard needs. */
export interface HistoricalSession {
  id: string
  providerId: string
  cwd: string | null
  /** Repo identity (provider-supplied, else derived from cwd). */
  repository: string | null
  branch: string | null
  createdAtMs: number
  updatedAtMs: number
  /** Best-effort; 0 when the provider can't supply it cheaply. */
  messageCount: number
  /** Best-effort; 0 when the provider can't supply it cheaply. */
  toolCallCount: number
}

/** Per-repository usage rollup. */
export interface RepoUsage {
  repo: string
  cwd: string | null
  sessions: number
  messages: number
  toolCalls: number
  lastActiveMs: number
  /** Distinct branches seen for this repo, most-recent first. */
  branches: string[]
}

/** One calendar day in the window (local time). */
export interface TimeBucket {
  /** Local midnight of the day, in ms. */
  dateMs: number
  /** Sessions started that day, keyed by providerId. */
  byProvider: Record<string, number>
  total: number
}

/** One hour×weekday heatmap cell. weekday: 0=Mon … 6=Sun. hour: 0–23. */
export interface HeatCell {
  weekday: number
  hour: number
  count: number
}

/** Per-provider session count. */
export interface ProviderSplit {
  providerId: string
  sessions: number
}

/** The full historical snapshot returned by the aggregation IPC. */
export interface DashboardMetrics {
  windowDays: number
  generatedAtMs: number
  totals: {
    sessions: number
    messages: number
    toolCalls: number
  }
  /**
   * Totals for the immediately preceding window of equal length (i.e. the
   * window `[now-2w, now-w]`). Used to render period-over-period deltas.
   */
  previousTotals: {
    sessions: number
    messages: number
    toolCalls: number
  }
  providerSplit: ProviderSplit[]
  topRepos: RepoUsage[]
  /** One bucket per day across the window, oldest → newest. */
  overTime: TimeBucket[]
  /** 168 cells (7 weekdays × 24 hours). */
  heatmap: HeatCell[]
}
