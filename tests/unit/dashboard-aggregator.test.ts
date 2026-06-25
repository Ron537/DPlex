/**
 * Unit tests for the dashboard aggregator. Pure function — no window stub,
 * no I/O. Verifies repo rollups, provider split, day bucketing, and the
 * hour×weekday heatmap against a fixed `nowMs`.
 */

import { describe, expect, it } from 'vitest'
import { computeDashboardMetrics } from '../../src/main/services/dashboard/dashboardAggregator'
import type { HistoricalSession } from '../../src/main/services/dashboard/types'

const DAY = 86_400_000

function makeSession(overrides: Partial<HistoricalSession>): HistoricalSession {
  return {
    id: Math.random().toString(36).slice(2),
    providerId: 'copilot-cli',
    cwd: '/work/repo-a',
    repository: 'repo-a',
    branch: 'main',
    createdAtMs: 0,
    updatedAtMs: 0,
    messageCount: 0,
    toolCallCount: 0,
    ...overrides
  }
}

// A stable "now": 2024-01-15 12:00 local.
const NOW = new Date(2024, 0, 15, 12, 0, 0).getTime()

describe('computeDashboardMetrics', () => {
  it('totals sessions, messages and tool calls within the window', () => {
    const sessions = [
      makeSession({ createdAtMs: NOW - DAY, messageCount: 3, toolCallCount: 10 }),
      makeSession({ createdAtMs: NOW - 2 * DAY, messageCount: 5, toolCallCount: 20 })
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.totals.sessions).toBe(2)
    expect(m.totals.messages).toBe(8)
    expect(m.totals.toolCalls).toBe(30)
  })

  it('excludes sessions created before the window cutoff', () => {
    const sessions = [
      makeSession({ createdAtMs: NOW - 2 * DAY }),
      makeSession({ createdAtMs: NOW - 40 * DAY }) // outside a 30d window
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.totals.sessions).toBe(1)
  })

  it('computes previousTotals for the immediately preceding window', () => {
    const sessions = [
      // current window (last 10 days)
      makeSession({ createdAtMs: NOW - 2 * DAY, messageCount: 5 }),
      makeSession({ createdAtMs: NOW - 4 * DAY, messageCount: 3 }),
      // previous window (10–20 days ago)
      makeSession({ createdAtMs: NOW - 12 * DAY, messageCount: 4 }),
      // older than two windows → excluded from both
      makeSession({ createdAtMs: NOW - 40 * DAY, messageCount: 99 })
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 10, nowMs: NOW })
    expect(m.totals.sessions).toBe(2)
    expect(m.totals.messages).toBe(8)
    expect(m.previousTotals.sessions).toBe(1)
    expect(m.previousTotals.messages).toBe(4)
  })

  it('ranks repos by session count and collects distinct branches', () => {
    const sessions = [
      makeSession({ repository: 'repo-a', branch: 'main', createdAtMs: NOW - DAY }),
      makeSession({ repository: 'repo-a', branch: 'feat-x', createdAtMs: NOW - 2 * DAY }),
      makeSession({ repository: 'repo-a', branch: 'main', createdAtMs: NOW - 3 * DAY }),
      makeSession({ repository: 'repo-b', branch: 'main', createdAtMs: NOW - DAY })
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.topRepos[0].repo).toBe('repo-a')
    expect(m.topRepos[0].sessions).toBe(3)
    expect(m.topRepos[0].branches.sort()).toEqual(['feat-x', 'main'])
    expect(m.topRepos[1].repo).toBe('repo-b')
  })

  it('derives a repo label from cwd basename when repository is missing', () => {
    const sessions = [
      makeSession({ repository: null, cwd: '/home/me/projects/cool-app', createdAtMs: NOW - DAY })
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.topRepos[0].repo).toBe('cool-app')
  })

  it('splits sessions by provider, sorted by count', () => {
    const sessions = [
      makeSession({ providerId: 'copilot-cli', createdAtMs: NOW - DAY }),
      makeSession({ providerId: 'copilot-cli', createdAtMs: NOW - 2 * DAY }),
      makeSession({ providerId: 'claude-code', createdAtMs: NOW - DAY })
    ]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.providerSplit[0]).toEqual({ providerId: 'copilot-cli', sessions: 2 })
    expect(m.providerSplit[1]).toEqual({ providerId: 'claude-code', sessions: 1 })
  })

  it('produces a gap-free daily bucket series oldest → newest', () => {
    const m = computeDashboardMetrics([], { windowDays: 7, nowMs: NOW })
    // 7-day window spans cutoff..now → 8 local-day boundaries inclusive.
    expect(m.overTime.length).toBeGreaterThanOrEqual(7)
    for (let i = 1; i < m.overTime.length; i++) {
      expect(m.overTime[i].dateMs).toBeGreaterThan(m.overTime[i - 1].dateMs)
    }
  })

  it('seeds buckets exactly at local midnight with no duplicate days (DST-safe)', () => {
    // Use a long window so it spans a DST transition in any DST timezone.
    const m = computeDashboardMetrics([], { windowDays: 90, nowMs: NOW })
    const seen = new Set<number>()
    for (const b of m.overTime) {
      // Each key must be local midnight: re-normalizing must be a no-op.
      const d = new Date(b.dateMs)
      const midnight = new Date(d).setHours(0, 0, 0, 0)
      expect(b.dateMs).toBe(midnight)
      // And every calendar day must appear at most once.
      expect(seen.has(b.dateMs)).toBe(false)
      seen.add(b.dateMs)
    }
  })

  it('buckets a session into the correct local day and provider', () => {
    const sessions = [makeSession({ providerId: 'claude-code', createdAtMs: NOW - DAY })]
    const m = computeDashboardMetrics(sessions, { windowDays: 7, nowMs: NOW })
    const hit = m.overTime.find((b) => b.total > 0)
    expect(hit).toBeDefined()
    expect(hit?.byProvider['claude-code']).toBe(1)
  })

  it('always returns a full 7×24 heatmap and counts the right cell', () => {
    // NOW is 2024-01-15 (a Monday) at 12:00 → weekday 0, hour 12.
    const sessions = [makeSession({ createdAtMs: NOW })]
    const m = computeDashboardMetrics(sessions, { windowDays: 30, nowMs: NOW })
    expect(m.heatmap).toHaveLength(168)
    const cell = m.heatmap.find((c) => c.weekday === 0 && c.hour === 12)
    expect(cell?.count).toBe(1)
  })

  it('handles an empty session list without throwing', () => {
    const m = computeDashboardMetrics([], { windowDays: 30, nowMs: NOW })
    expect(m.totals.sessions).toBe(0)
    expect(m.topRepos).toEqual([])
    expect(m.heatmap).toHaveLength(168)
  })
})
