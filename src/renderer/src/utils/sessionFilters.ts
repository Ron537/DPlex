import type { AISession } from '../types'

export interface SessionFilterOptions {
  searchQuery: string
  providerFilter: string
  statusFilters: Set<string>
  hideEmptySessions: boolean
}

/**
 * Apply the search / provider / status / empty-session filters to a list of
 * AI sessions. Pure function — no store or React dependencies — so it can
 * drive both the renderer and unit tests.
 *
 * Filter semantics:
 * - `searchQuery` matches (case-insensitive) against displayName, id, summary,
 *   cwd, and branch.
 * - `providerFilter === 'all'` disables the provider filter.
 * - `statusFilters` is a multi-select set. If it contains 'all' the filter is
 *   disabled; otherwise a session passes if it matches ANY selected bucket:
 *     - 'active': session.status === 'active'
 *     - 'idle': detailedStatus === 'idle'
 *     - 'running': detailedStatus ∈ {thinking, executingTool}
 *     - 'waiting': detailedStatus ∈ {awaitingApproval, waitingForUser}
 * - `hideEmptySessions` removes idle sessions with no messages. Active
 *   sessions are always retained (user may be mid-prompt before the first
 *   message is recorded).
 */
export function filterSessions(
  sessions: AISession[],
  opts: SessionFilterOptions
): AISession[] {
  const q = opts.searchQuery.toLowerCase()
  let filtered = q
    ? sessions.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.summary && s.summary.toLowerCase().includes(q)) ||
          (s.cwd && s.cwd.toLowerCase().includes(q)) ||
          (s.branch && s.branch.toLowerCase().includes(q))
      )
    : sessions

  if (opts.providerFilter !== 'all') {
    filtered = filtered.filter((s) => s.aiTool === opts.providerFilter)
  }

  if (!opts.statusFilters.has('all')) {
    filtered = filtered.filter((s) => {
      const detailed = s.detailedStatus ?? (s.status === 'active' ? 'thinking' : 'idle')
      if (opts.statusFilters.has('active') && s.status === 'active') return true
      if (opts.statusFilters.has('idle') && detailed === 'idle') return true
      if (
        opts.statusFilters.has('running') &&
        (detailed === 'thinking' || detailed === 'executingTool')
      )
        return true
      if (
        opts.statusFilters.has('waiting') &&
        (detailed === 'awaitingApproval' || detailed === 'waitingForUser')
      )
        return true
      return false
    })
  }

  if (opts.hideEmptySessions) {
    filtered = filtered.filter(
      (s) => s.status === 'active' || (s.messageCount ?? 0) > 0
    )
  }

  return filtered
}
