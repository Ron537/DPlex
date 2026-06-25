import type { AISession, SessionStatus } from '../types'

/** CSS variable carrying the themed color for each detailed status. */
export const STATUS_VAR: Record<SessionStatus, string> = {
  idle: 'var(--dplex-status-idle)',
  thinking: 'var(--dplex-status-thinking)',
  executingTool: 'var(--dplex-status-executing)',
  awaitingApproval: 'var(--dplex-status-approval)',
  waitingForUser: 'var(--dplex-status-waiting)'
}

/** Short human label for each detailed status. */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  executingTool: 'Executing tool',
  awaitingApproval: 'Awaiting approval',
  waitingForUser: 'Waiting for you'
}

/** Order used when rendering the status donut / legend. */
export const STATUS_ORDER: SessionStatus[] = [
  'executingTool',
  'thinking',
  'awaitingApproval',
  'waitingForUser',
  'idle'
]

/** Effective detailed status for a session, collapsing active-but-untyped → thinking. */
export function effectiveStatus(s: AISession): SessionStatus {
  if (s.status !== 'active') return 'idle'
  return s.detailedStatus ?? 'thinking'
}

export interface LiveKpis {
  activeCount: number
  needsYouCount: number
  approvalCount: number
  inputCount: number
  sessionsToday: number
  statusCounts: Record<SessionStatus, number>
}

/** Whether a timestamp falls on the local calendar "today". */
function isToday(d: Date): boolean {
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

/**
 * Derive the live KPI numbers from the session list. Pure — depends only on
 * its inputs, so it memoizes cleanly in a component.
 *
 * "Needs you" is derived from each session's live `detailedStatus` (the same
 * source the Sessions panel's "waiting" filter and the status donut use), NOT
 * from the attention inbox — inbox notifications can be acknowledged, dismissed
 * or seeded and drift out of sync with the real session state.
 */
export function computeLiveKpis(sessions: readonly AISession[]): LiveKpis {
  const statusCounts: Record<SessionStatus, number> = {
    idle: 0,
    thinking: 0,
    executingTool: 0,
    awaitingApproval: 0,
    waitingForUser: 0
  }
  let activeCount = 0
  let sessionsToday = 0
  for (const s of sessions) {
    statusCounts[effectiveStatus(s)] += 1
    if (s.status === 'active') activeCount += 1
    if (isToday(s.createdAt)) sessionsToday += 1
  }

  const approvalCount = statusCounts.awaitingApproval
  const inputCount = statusCounts.waitingForUser

  return {
    activeCount,
    needsYouCount: approvalCount + inputCount,
    approvalCount,
    inputCount,
    sessionsToday,
    statusCounts
  }
}

/** Most-recently-active sessions, newest first. */
export function recentSessions(sessions: readonly AISession[], limit = 8): AISession[] {
  return [...sessions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit)
}

/** Relative "time ago" label for a timestamp. */
export function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 45_000) return 'just now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** Compact duration label, e.g. 45s / 14m / 2h 14m / 3d 4h. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export interface Housekeeping {
  /** Age (ms) the longest-waiting session has been waiting, or null when none. */
  oldestWaitingMs: number | null
  oldestWaitingLabel: string | null
  /** Session id of the oldest-waiting session (for focusing it in the panel). */
  oldestWaitingSessionId: string | null
  /** Active sessions that have gone quiet beyond the idle-too-long threshold. */
  staleCount: number
  /** Elapsed (ms) of the longest-running active session, or null. */
  longestActiveMs: number | null
  longestActiveName: string | null
  /** Session id of the longest-running active session. */
  longestActiveSessionId: string | null
}

/**
 * Live "housekeeping" signals from the session list — the actionable things a
 * user should clean up. Pure over its inputs.
 *
 * "Oldest awaiting you" is derived from each session's live `detailedStatus`
 * (awaitingApproval / waitingForUser), NOT the attention inbox — inbox
 * notifications can be acknowledged/dismissed/seeded and drift out of sync,
 * which would make this disagree with the Sessions panel's "waiting" filter.
 */
export function computeHousekeeping(
  sessions: readonly AISession[],
  idleTooLongMinutes: number,
  nowMs: number = Date.now()
): Housekeeping {
  const thresholdMs = Math.max(1, idleTooLongMinutes) * 60_000
  let oldestWaitingMs: number | null = null
  let oldestWaitingLabel: string | null = null
  let oldestWaitingSessionId: string | null = null
  let staleCount = 0
  let longestActiveMs: number | null = null
  let longestActiveName: string | null = null
  let longestActiveSessionId: string | null = null

  for (const s of sessions) {
    const status = effectiveStatus(s)

    // Oldest session that needs the user. The wait age is approximated by the
    // time since last activity (when the agent asked). "Oldest" = the largest
    // such age, so a session waiting longer always wins over a newer one.
    if (status === 'awaitingApproval' || status === 'waitingForUser') {
      const since = s.lastActivityTime ?? s.updatedAt.getTime()
      const age = nowMs - since
      if (oldestWaitingMs === null || age > oldestWaitingMs) {
        oldestWaitingMs = age
        oldestWaitingLabel = `${s.displayName} · ${
          status === 'awaitingApproval' ? 'approval' : 'input'
        }`
        oldestWaitingSessionId = s.id
      }
    }

    // Stale + longest-active only consider running sessions (lock alive).
    if (s.status !== 'active') continue
    const elapsed = nowMs - s.createdAt.getTime()
    if (longestActiveMs === null || elapsed > longestActiveMs) {
      longestActiveMs = elapsed
      longestActiveName = s.displayName
      longestActiveSessionId = s.id
    }
    const last = s.lastActivityTime ?? s.updatedAt.getTime()
    if (nowMs - last > thresholdMs) staleCount += 1
  }

  return {
    oldestWaitingMs,
    oldestWaitingLabel,
    oldestWaitingSessionId,
    staleCount,
    longestActiveMs,
    longestActiveName,
    longestActiveSessionId
  }
}

/** Percentage change current-vs-previous; null when there's no prior baseline. */
export function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

/** Average to one decimal, guarding divide-by-zero. */
export function average(total: number, count: number): number {
  if (count <= 0) return 0
  return Math.round((total / count) * 10) / 10
}

/**
 * Trailing active-day streak: consecutive most-recent days with ≥1 session. A
 * zero on the final bucket (today, possibly not started yet) doesn't break it.
 */
export function activeStreak(overTime: ReadonlyArray<{ total: number }>): number {
  let streak = 0
  let i = overTime.length - 1
  // Allow today (last bucket) to be empty without ending the streak.
  if (i >= 0 && overTime[i].total === 0) i -= 1
  for (; i >= 0; i--) {
    if (overTime[i].total > 0) streak += 1
    else break
  }
  return streak
}

/** Busiest weekday (0=Mon) and hour from the heatmap, or null when empty. */
export function busiestSlot(
  heatmap: ReadonlyArray<{ weekday: number; hour: number; count: number }>
): { weekday: number; hour: number } | null {
  const byWeekday = new Array(7).fill(0)
  const byHour = new Array(24).fill(0)
  let any = false
  for (const c of heatmap) {
    if (c.count <= 0) continue
    any = true
    byWeekday[c.weekday] += c.count
    byHour[c.hour] += c.count
  }
  if (!any) return null
  const weekday = byWeekday.indexOf(Math.max(...byWeekday))
  const hour = byHour.indexOf(Math.max(...byHour))
  return { weekday, hour }
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Full weekday name for a Monday-first index. */
export function weekdayName(index: number): string {
  return WEEKDAY_NAMES[index] ?? ''
}

/** Per-provider share of sessions as integer percentages (largest first). */
export function providerShares(
  providerSplit: ReadonlyArray<{ providerId: string; sessions: number }>
): { providerId: string; sessions: number; pct: number }[] {
  const total = providerSplit.reduce((sum, p) => sum + p.sessions, 0)
  return providerSplit
    .map((p) => ({ ...p, pct: total > 0 ? Math.round((p.sessions / total) * 100) : 0 }))
    .sort((a, b) => b.sessions - a.sessions)
}
