import type {
  DashboardMetrics,
  HeatCell,
  HistoricalSession,
  ProviderSplit,
  RepoUsage,
  TimeBucket
} from './types'

/** Default number of top repositories surfaced. */
const DEFAULT_TOP_REPOS = 8

/** Basename of a filesystem path, tolerating both `/` and `\` separators. */
function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

/**
 * Derive a stable repo label for a session. Prefers the provider-supplied
 * `repository`, then the cwd basename, then a sentinel.
 */
function repoLabel(s: HistoricalSession): string {
  if (s.repository && s.repository.trim()) return s.repository.trim()
  if (s.cwd && s.cwd.trim()) return basename(s.cwd.trim())
  return 'unknown'
}

/** Local midnight (ms) for a given timestamp. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Weekday index with Monday=0 … Sunday=6 (JS getDay is Sunday=0). */
function mondayFirstWeekday(ms: number): number {
  const js = new Date(ms).getDay()
  return (js + 6) % 7
}

/**
 * Aggregate a flat list of historical sessions into a dashboard snapshot.
 * Pure — no I/O, no Date.now() unless `nowMs` is omitted. Safe to unit test.
 */
export function computeDashboardMetrics(
  sessions: HistoricalSession[],
  opts: { windowDays: number; nowMs?: number; topRepos?: number }
): DashboardMetrics {
  const nowMs = opts.nowMs ?? Date.now()
  const windowDays = Math.max(1, Math.floor(opts.windowDays))
  const topReposN = opts.topRepos ?? DEFAULT_TOP_REPOS
  const windowMs = windowDays * 86_400_000
  const cutoffMs = nowMs - windowMs
  const prevCutoffMs = nowMs - 2 * windowMs

  // Defensive: only consider sessions created within the window.
  const inWindow = sessions.filter((s) => s.createdAtMs >= cutoffMs && s.createdAtMs <= nowMs)

  // Previous equal-length window `[now-2w, now-w)` for period-over-period deltas.
  const previousTotals = { sessions: 0, messages: 0, toolCalls: 0 }
  for (const s of sessions) {
    if (s.createdAtMs >= prevCutoffMs && s.createdAtMs < cutoffMs) {
      previousTotals.sessions += 1
      previousTotals.messages += s.messageCount
      previousTotals.toolCalls += s.toolCallCount
    }
  }

  // ── Totals & provider split ──────────────────────────────────────
  const totals = { sessions: inWindow.length, messages: 0, toolCalls: 0 }
  const providerCounts = new Map<string, number>()
  for (const s of inWindow) {
    totals.messages += s.messageCount
    totals.toolCalls += s.toolCallCount
    providerCounts.set(s.providerId, (providerCounts.get(s.providerId) ?? 0) + 1)
  }
  const providerSplit: ProviderSplit[] = Array.from(providerCounts, ([providerId, count]) => ({
    providerId,
    sessions: count
  })).sort((a, b) => b.sessions - a.sessions)

  // ── Top repos ────────────────────────────────────────────────────
  const repoMap = new Map<string, RepoUsage & { branchSeen: Map<string, number> }>()
  for (const s of inWindow) {
    const repo = repoLabel(s)
    let r = repoMap.get(repo)
    if (!r) {
      r = {
        repo,
        cwd: s.cwd,
        sessions: 0,
        messages: 0,
        toolCalls: 0,
        lastActiveMs: 0,
        branches: [],
        branchSeen: new Map()
      }
      repoMap.set(repo, r)
    }
    r.sessions += 1
    r.messages += s.messageCount
    r.toolCalls += s.toolCallCount
    r.lastActiveMs = Math.max(r.lastActiveMs, s.updatedAtMs)
    if (s.branch && s.branch.trim()) {
      const b = s.branch.trim()
      r.branchSeen.set(b, Math.max(r.branchSeen.get(b) ?? 0, s.updatedAtMs))
    }
  }
  const topRepos: RepoUsage[] = Array.from(repoMap.values())
    .map(({ branchSeen, ...rest }) => ({
      ...rest,
      branches: Array.from(branchSeen.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([b]) => b)
    }))
    .sort((a, b) => b.sessions - a.sessions || b.lastActiveMs - a.lastActiveMs)
    .slice(0, topReposN)

  // ── Over-time buckets (one per day, oldest → newest) ─────────────
  const bucketByDay = new Map<number, TimeBucket>()
  // Seed every day in the window so the chart has no gaps. Advance by
  // re-normalizing to local midnight each step (adding ~26h then snapping
  // back) so DST transitions — where consecutive local midnights are 23h or
  // 25h apart — don't drift the seeded keys off `startOfLocalDay`, which would
  // otherwise double-count or skip days for the rest of the window.
  const firstDay = startOfLocalDay(cutoffMs)
  const lastDay = startOfLocalDay(nowMs)
  for (let day = firstDay; day <= lastDay; day = startOfLocalDay(day + 26 * 3_600_000)) {
    bucketByDay.set(day, { dateMs: day, byProvider: {}, total: 0 })
  }
  for (const s of inWindow) {
    const day = startOfLocalDay(s.createdAtMs)
    let bucket = bucketByDay.get(day)
    if (!bucket) {
      bucket = { dateMs: day, byProvider: {}, total: 0 }
      bucketByDay.set(day, bucket)
    }
    bucket.byProvider[s.providerId] = (bucket.byProvider[s.providerId] ?? 0) + 1
    bucket.total += 1
  }
  const overTime: TimeBucket[] = Array.from(bucketByDay.values()).sort(
    (a, b) => a.dateMs - b.dateMs
  )

  // ── Heatmap (7×24, Monday-first) ─────────────────────────────────
  const heatIndex = new Map<number, HeatCell>()
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) {
      heatIndex.set(wd * 24 + h, { weekday: wd, hour: h, count: 0 })
    }
  }
  for (const s of inWindow) {
    const wd = mondayFirstWeekday(s.createdAtMs)
    const hour = new Date(s.createdAtMs).getHours()
    const cell = heatIndex.get(wd * 24 + hour)
    if (cell) cell.count += 1
  }
  const heatmap: HeatCell[] = Array.from(heatIndex.values())

  return {
    windowDays,
    generatedAtMs: nowMs,
    totals,
    previousTotals,
    providerSplit,
    topRepos,
    overTime,
    heatmap
  }
}
