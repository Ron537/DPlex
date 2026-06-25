/**
 * Unit tests for the renderer-side live dashboard derivations
 * (`computeLiveKpis`, `computeHousekeeping`, helpers). Pure functions over the
 * session list — no store or window access required.
 */

import { describe, expect, it } from 'vitest'
import {
  computeLiveKpis,
  computeHousekeeping,
  recentSessions,
  effectiveStatus,
  timeAgo,
  formatDuration,
  pctDelta,
  average,
  activeStreak,
  busiestSlot,
  providerShares,
  weekdayName
} from '../../src/renderer/src/utils/dashboardMetrics'
import type { AISession } from '../../src/renderer/src/types'

function session(overrides: Partial<AISession>): AISession {
  return {
    id: Math.random().toString(36).slice(2),
    displayName: 'Session',
    status: 'idle',
    aiTool: 'copilot-cli',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }
}

describe('effectiveStatus', () => {
  it('reports idle for non-active sessions regardless of detailedStatus', () => {
    expect(effectiveStatus(session({ status: 'idle', detailedStatus: 'thinking' }))).toBe('idle')
  })

  it('falls back to thinking for active-but-untyped sessions', () => {
    expect(effectiveStatus(session({ status: 'active', detailedStatus: undefined }))).toBe(
      'thinking'
    )
  })
})

describe('computeLiveKpis', () => {
  it('counts active sessions and breaks down by status', () => {
    const sessions = [
      session({ status: 'active', detailedStatus: 'executingTool' }),
      session({ status: 'active', detailedStatus: 'thinking' }),
      session({ status: 'idle' })
    ]
    const kpis = computeLiveKpis(sessions)
    expect(kpis.activeCount).toBe(2)
    expect(kpis.statusCounts.executingTool).toBe(1)
    expect(kpis.statusCounts.thinking).toBe(1)
    expect(kpis.statusCounts.idle).toBe(1)
  })

  it('derives needs-you counts from live session status, not the inbox', () => {
    const sessions = [
      session({ status: 'active', detailedStatus: 'awaitingApproval' }),
      session({ status: 'active', detailedStatus: 'waitingForUser' }),
      session({ status: 'active', detailedStatus: 'waitingForUser' }),
      session({ status: 'active', detailedStatus: 'thinking' }),
      session({ status: 'idle' })
    ]
    const kpis = computeLiveKpis(sessions)
    expect(kpis.approvalCount).toBe(1)
    expect(kpis.inputCount).toBe(2)
    expect(kpis.needsYouCount).toBe(3)
  })

  it('does not count a non-active session as needing you (stale status)', () => {
    // An idle session whose detailedStatus is stale must not inflate needs-you.
    const kpis = computeLiveKpis([session({ status: 'idle', detailedStatus: 'awaitingApproval' })])
    expect(kpis.needsYouCount).toBe(0)
  })

  it('counts only sessions created today', () => {
    const old = session({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
    const fresh = session({ createdAt: new Date() })
    const kpis = computeLiveKpis([old, fresh])
    expect(kpis.sessionsToday).toBe(1)
  })
})

describe('recentSessions', () => {
  it('returns sessions newest-first, capped at the limit', () => {
    const a = session({ displayName: 'a', updatedAt: new Date(1000) })
    const b = session({ displayName: 'b', updatedAt: new Date(3000) })
    const c = session({ displayName: 'c', updatedAt: new Date(2000) })
    const out = recentSessions([a, b, c], 2)
    expect(out.map((s) => s.displayName)).toEqual(['b', 'c'])
  })
})

describe('timeAgo', () => {
  it('labels sub-minute as "just now"', () => {
    expect(timeAgo(Date.now() - 5_000)).toBe('just now')
  })
  it('labels minutes, hours and days', () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toMatch(/m ago/)
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toMatch(/h ago/)
    expect(timeAgo(Date.now() - 2 * 86_400_000)).toMatch(/d ago/)
  })
})

describe('formatDuration', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(5 * 60_000)).toBe('5m')
    expect(formatDuration(2 * 3_600_000 + 14 * 60_000)).toBe('2h 14m')
    expect(formatDuration(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
  })
})

describe('computeHousekeeping', () => {
  const NOW = Date.now()
  it('finds the OLDEST waiting session (by detailedStatus), not the newest', () => {
    const hk = computeHousekeeping(
      [
        session({
          id: 'recent-id',
          displayName: 'recent',
          status: 'active',
          detailedStatus: 'awaitingApproval',
          lastActivityTime: NOW - 10 * 60_000
        }),
        session({
          id: 'old-id',
          displayName: 'old',
          status: 'active',
          detailedStatus: 'waitingForUser',
          lastActivityTime: NOW - 30 * 60_000
        })
      ],
      30,
      NOW
    )
    // The session waiting 30m must win over the one waiting 10m.
    expect(Math.round((hk.oldestWaitingMs ?? 0) / 60_000)).toBe(30)
    expect(hk.oldestWaitingLabel).toContain('old')
    expect(hk.oldestWaitingSessionId).toBe('old-id')
  })

  it('picks the oldest waiting regardless of input ordering', () => {
    const hk = computeHousekeeping(
      [
        session({
          id: 'oldest',
          status: 'active',
          detailedStatus: 'awaitingApproval',
          lastActivityTime: NOW - 50 * 60_000
        }),
        session({
          id: 'newest',
          status: 'active',
          detailedStatus: 'waitingForUser',
          lastActivityTime: NOW - 5 * 60_000
        })
      ],
      30,
      NOW
    )
    expect(hk.oldestWaitingSessionId).toBe('oldest')
    expect(Math.round((hk.oldestWaitingMs ?? 0) / 60_000)).toBe(50)
  })

  it('reports nothing waiting when no active session needs the user', () => {
    const hk = computeHousekeeping(
      [
        session({ status: 'active', detailedStatus: 'thinking' }),
        // Stale idle status must not register as waiting.
        session({ status: 'idle', detailedStatus: 'awaitingApproval' })
      ],
      30,
      NOW
    )
    expect(hk.oldestWaitingMs).toBeNull()
    expect(hk.oldestWaitingSessionId).toBeNull()
  })

  it('counts only ACTIVE sessions that have gone quiet beyond the threshold', () => {
    // Active but quiet for 45m → stale. Active and recently active → not.
    // Idle (non-active) sessions are excluded regardless of how old they are.
    const activeQuiet = session({
      status: 'active',
      createdAt: new Date(NOW - 2 * 3_600_000),
      lastActivityTime: NOW - 45 * 60_000
    })
    const activeBusy = session({
      status: 'active',
      createdAt: new Date(NOW - 2 * 3_600_000),
      lastActivityTime: NOW - 2 * 60_000
    })
    const oldIdle = session({ status: 'idle', lastActivityTime: NOW - 10 * 86_400_000 })
    const hk = computeHousekeeping([activeQuiet, activeBusy, oldIdle], 30, NOW)
    expect(hk.staleCount).toBe(1)
  })

  it('falls back to updatedAt when an active session has no lastActivityTime', () => {
    const s = session({
      status: 'active',
      createdAt: new Date(NOW - 3 * 3_600_000),
      updatedAt: new Date(NOW - 50 * 60_000),
      lastActivityTime: undefined
    })
    const hk = computeHousekeeping([s], 30, NOW)
    expect(hk.staleCount).toBe(1)
  })

  it('reports the longest-running active session and its id', () => {
    const a = session({
      id: 'short-id',
      status: 'active',
      createdAt: new Date(NOW - 30 * 60_000),
      displayName: 'short'
    })
    const b = session({
      id: 'long-id',
      status: 'active',
      createdAt: new Date(NOW - 2 * 3_600_000),
      displayName: 'long'
    })
    const hk = computeHousekeeping([a, b], 30, NOW)
    expect(hk.longestActiveName).toBe('long')
    expect(hk.longestActiveSessionId).toBe('long-id')
    expect(Math.round((hk.longestActiveMs ?? 0) / 3_600_000)).toBe(2)
  })
})

describe('pctDelta / average', () => {
  it('computes percentage change and guards a zero baseline', () => {
    expect(pctDelta(120, 100)).toBe(20)
    expect(pctDelta(80, 100)).toBe(-20)
    expect(pctDelta(5, 0)).toBeNull()
  })
  it('averages to one decimal and guards divide-by-zero', () => {
    expect(average(24, 10)).toBe(2.4)
    expect(average(5, 0)).toBe(0)
  })
})

describe('activeStreak', () => {
  it('counts consecutive trailing active days', () => {
    expect(activeStreak([{ total: 1 }, { total: 0 }, { total: 2 }, { total: 3 }])).toBe(2)
  })
  it("doesn't let an empty final day (today) break the streak", () => {
    expect(activeStreak([{ total: 2 }, { total: 3 }, { total: 0 }])).toBe(2)
  })
  it('returns 0 when the most recent days are empty', () => {
    expect(activeStreak([{ total: 1 }, { total: 0 }, { total: 0 }])).toBe(0)
  })
})

describe('busiestSlot', () => {
  it('finds the busiest weekday and hour', () => {
    const cells = [
      { weekday: 2, hour: 15, count: 10 },
      { weekday: 2, hour: 16, count: 4 },
      { weekday: 0, hour: 9, count: 1 }
    ]
    expect(busiestSlot(cells)).toEqual({ weekday: 2, hour: 15 })
  })
  it('returns null when empty', () => {
    expect(busiestSlot([{ weekday: 0, hour: 0, count: 0 }])).toBeNull()
  })
})

describe('providerShares', () => {
  it('computes integer percentages, largest first', () => {
    const out = providerShares([
      { providerId: 'claude-code', sessions: 1 },
      { providerId: 'copilot-cli', sessions: 3 }
    ])
    expect(out[0]).toEqual({ providerId: 'copilot-cli', sessions: 3, pct: 75 })
    expect(out[1].pct).toBe(25)
  })
})

describe('weekdayName', () => {
  it('maps Monday-first indices', () => {
    expect(weekdayName(0)).toBe('Monday')
    expect(weekdayName(6)).toBe('Sunday')
  })
})
