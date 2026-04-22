import { describe, it, expect } from 'vitest'
import { filterSessions } from '../../src/renderer/src/utils/sessionFilters'
import type { AISession } from '../../src/renderer/src/types'

function makeSession(overrides: Partial<AISession> = {}): AISession {
  return {
    id: 'sess-1',
    displayName: 'My Session',
    status: 'idle',
    aiTool: 'copilot-cli',
    createdAt: new Date('2026-04-20T10:00:00Z'),
    updatedAt: new Date('2026-04-20T10:00:00Z'),
    cwd: '/Users/me/projects/foo',
    summary: 'Refactor auth module',
    branch: 'main',
    messageCount: 3,
    ...overrides
  }
}

const NO_FILTERS = {
  searchQuery: '',
  providerFilter: 'all',
  statusFilters: new Set(['all']),
  hideEmptySessions: false
}

describe('filterSessions', () => {
  describe('no filters', () => {
    it('returns all sessions when every filter is off', () => {
      const a = makeSession({ id: 'a' })
      const b = makeSession({ id: 'b', status: 'active' })
      const result = filterSessions([a, b], NO_FILTERS)
      expect(result).toHaveLength(2)
      expect(result).toEqual([a, b])
    })

    it('returns empty array when input is empty', () => {
      expect(filterSessions([], NO_FILTERS)).toEqual([])
    })
  })

  describe('searchQuery', () => {
    const sessions = [
      makeSession({ id: 'abc-123', displayName: 'Refactor parser', summary: 'Clean up lexer', cwd: '/x/parser', branch: 'feat/parse' }),
      makeSession({ id: 'def-456', displayName: 'Add tests', summary: 'Unit + e2e', cwd: '/x/web', branch: 'feat/tests' }),
      makeSession({ id: 'ghi-789', displayName: 'Fix bug', summary: undefined, cwd: undefined, branch: undefined })
    ]

    it('matches against displayName (case-insensitive)', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'REFACTOR' })
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('abc-123')
    })

    it('matches against id', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'def' })
      expect(result.map((s) => s.id)).toEqual(['def-456'])
    })

    it('matches against summary', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'lexer' })
      expect(result.map((s) => s.id)).toEqual(['abc-123'])
    })

    it('matches against cwd', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: '/x/web' })
      expect(result.map((s) => s.id)).toEqual(['def-456'])
    })

    it('matches against branch', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'feat/tests' })
      expect(result.map((s) => s.id)).toEqual(['def-456'])
    })

    it('returns empty when nothing matches', () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'zzz' })).toEqual([])
    })

    it('handles sessions with missing optional fields', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, searchQuery: 'fix bug' })
      expect(result.map((s) => s.id)).toEqual(['ghi-789'])
    })

    it('empty search string is treated as no filter', () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, searchQuery: '' })).toHaveLength(3)
    })
  })

  describe('providerFilter', () => {
    const sessions = [
      makeSession({ id: 'a', aiTool: 'copilot-cli' }),
      makeSession({ id: 'b', aiTool: 'claude-code' }),
      makeSession({ id: 'c', aiTool: 'copilot-cli' })
    ]

    it("'all' disables the filter", () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, providerFilter: 'all' })).toHaveLength(3)
    })

    it('filters by specific provider', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, providerFilter: 'copilot-cli' })
      expect(result.map((s) => s.id)).toEqual(['a', 'c'])
    })

    it('returns empty when no session matches the provider', () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, providerFilter: 'nonexistent' })).toEqual([])
    })
  })

  describe('statusFilters', () => {
    const sessions = [
      makeSession({ id: 'active', status: 'active', detailedStatus: 'thinking' }),
      makeSession({ id: 'active-idle-detailed', status: 'active', detailedStatus: 'idle' }),
      makeSession({ id: 'idle-idle', status: 'idle', detailedStatus: 'idle' }),
      makeSession({ id: 'idle-thinking', status: 'idle', detailedStatus: 'thinking' }),
      makeSession({ id: 'idle-exec', status: 'idle', detailedStatus: 'executingTool' }),
      makeSession({ id: 'idle-approval', status: 'idle', detailedStatus: 'awaitingApproval' }),
      makeSession({ id: 'idle-waituser', status: 'idle', detailedStatus: 'waitingForUser' }),
      makeSession({ id: 'idle-undetailed', status: 'idle', detailedStatus: undefined })
    ]

    it("'all' disables the filter", () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['all']) })).toHaveLength(sessions.length)
    })

    it("'active' bucket matches status === 'active' regardless of detailedStatus", () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['active']) })
      expect(result.map((s) => s.id).sort()).toEqual(['active', 'active-idle-detailed'])
    })

    it("'idle' bucket matches only sessions whose detailedStatus === 'idle'", () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['idle']) })
      // idle-idle matches (detailed='idle'); idle-undetailed matches (falls back to 'idle');
      // active-idle-detailed ALSO matches (detailed='idle'); it's not in the active bucket here.
      expect(result.map((s) => s.id).sort()).toEqual(
        ['active-idle-detailed', 'idle-idle', 'idle-undetailed'].sort()
      )
    })

    it("'running' bucket matches thinking + executingTool", () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['running']) })
      expect(result.map((s) => s.id).sort()).toEqual(['active', 'idle-exec', 'idle-thinking'])
    })

    it("'waiting' bucket matches awaitingApproval + waitingForUser", () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['waiting']) })
      expect(result.map((s) => s.id).sort()).toEqual(['idle-approval', 'idle-waituser'])
    })

    it('multi-select combines buckets with OR', () => {
      const result = filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set(['active', 'waiting']) })
      expect(result.map((s) => s.id).sort()).toEqual(
        ['active', 'active-idle-detailed', 'idle-approval', 'idle-waituser'].sort()
      )
    })

    it('empty statusFilters (no "all", no buckets) returns no sessions', () => {
      expect(filterSessions(sessions, { ...NO_FILTERS, statusFilters: new Set() })).toEqual([])
    })

    it('idle session with undefined detailedStatus is treated as idle', () => {
      const only = [makeSession({ id: 'x', status: 'idle', detailedStatus: undefined })]
      expect(filterSessions(only, { ...NO_FILTERS, statusFilters: new Set(['idle']) })).toHaveLength(1)
    })

    it('active session with undefined detailedStatus is treated as thinking (running bucket)', () => {
      const only = [makeSession({ id: 'x', status: 'active', detailedStatus: undefined })]
      expect(filterSessions(only, { ...NO_FILTERS, statusFilters: new Set(['running']) })).toHaveLength(1)
    })
  })

  describe('hideEmptySessions', () => {
    it('keeps all sessions when disabled', () => {
      const sessions = [
        makeSession({ id: 'a', status: 'idle', messageCount: 0 }),
        makeSession({ id: 'b', status: 'idle', messageCount: undefined }),
        makeSession({ id: 'c', status: 'idle', messageCount: 5 })
      ]
      const result = filterSessions(sessions, { ...NO_FILTERS, hideEmptySessions: false })
      expect(result).toHaveLength(3)
    })

    it('removes idle sessions with messageCount === 0', () => {
      const sessions = [
        makeSession({ id: 'empty', status: 'idle', messageCount: 0 }),
        makeSession({ id: 'nonempty', status: 'idle', messageCount: 3 })
      ]
      const result = filterSessions(sessions, { ...NO_FILTERS, hideEmptySessions: true })
      expect(result.map((s) => s.id)).toEqual(['nonempty'])
    })

    it('removes idle sessions with messageCount === undefined', () => {
      const sessions = [
        makeSession({ id: 'no-count', status: 'idle', messageCount: undefined }),
        makeSession({ id: 'ok', status: 'idle', messageCount: 1 })
      ]
      const result = filterSessions(sessions, { ...NO_FILTERS, hideEmptySessions: true })
      expect(result.map((s) => s.id)).toEqual(['ok'])
    })

    it('always keeps active sessions even if empty', () => {
      const sessions = [
        makeSession({ id: 'active-empty', status: 'active', messageCount: 0 }),
        makeSession({ id: 'active-no-count', status: 'active', messageCount: undefined }),
        makeSession({ id: 'idle-empty', status: 'idle', messageCount: 0 })
      ]
      const result = filterSessions(sessions, { ...NO_FILTERS, hideEmptySessions: true })
      expect(result.map((s) => s.id).sort()).toEqual(['active-empty', 'active-no-count'])
    })
  })

  describe('filter composition', () => {
    const sessions = [
      makeSession({ id: 'a', aiTool: 'copilot-cli', status: 'idle', messageCount: 5, displayName: 'Auth work' }),
      makeSession({ id: 'b', aiTool: 'copilot-cli', status: 'idle', messageCount: 0, displayName: 'Auth empty' }),
      makeSession({ id: 'c', aiTool: 'claude-code', status: 'idle', messageCount: 5, displayName: 'Auth claude' }),
      makeSession({ id: 'd', aiTool: 'copilot-cli', status: 'active', messageCount: 0, displayName: 'Auth active', detailedStatus: 'thinking' }),
      makeSession({ id: 'e', aiTool: 'copilot-cli', status: 'idle', messageCount: 5, displayName: 'Unrelated', summary: 'Totally different', branch: 'other' })
    ]

    it('applies search + provider + hideEmpty together', () => {
      const result = filterSessions(sessions, {
        searchQuery: 'auth',
        providerFilter: 'copilot-cli',
        statusFilters: new Set(['all']),
        hideEmptySessions: true
      })
      // 'a' (matches all), 'd' (active is always kept even if empty)
      expect(result.map((s) => s.id).sort()).toEqual(['a', 'd'])
    })

    it('applies status filter on top of search', () => {
      const result = filterSessions(sessions, {
        searchQuery: 'auth',
        providerFilter: 'all',
        statusFilters: new Set(['active']),
        hideEmptySessions: false
      })
      expect(result.map((s) => s.id)).toEqual(['d'])
    })

    it('returns empty when filters leave no sessions', () => {
      const result = filterSessions(sessions, {
        searchQuery: 'nonexistent',
        providerFilter: 'all',
        statusFilters: new Set(['all']),
        hideEmptySessions: false
      })
      expect(result).toEqual([])
    })
  })
})
