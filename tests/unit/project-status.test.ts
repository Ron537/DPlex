import { describe, expect, it } from 'vitest'
import {
  getAvatarColor,
  getAvatarInitials,
  getProjectStatus,
  getRailBackground
} from '../../src/renderer/src/utils/projectStatus'
import type { ProjectActivity } from '../../src/renderer/src/hooks/useProjectSessions'

function activity(partial: Partial<ProjectActivity>): ProjectActivity {
  return {
    sessions: [],
    openTabs: [],
    activeCount: 0,
    hasActive: false,
    lastActivity: undefined,
    ...partial
  }
}

describe('projectStatus', () => {
  describe('getProjectStatus', () => {
    it('returns "live" when there is at least one active session', () => {
      expect(getProjectStatus(activity({ hasActive: true, activeCount: 2 }))).toBe('live')
    })

    it('returns "idle" when nothing is running', () => {
      expect(getProjectStatus(activity({}))).toBe('idle')
    })

    it('treats open terminals alone as idle (consistent with hasActive semantics)', () => {
      // openTabs alone does not flip hasActive — a plain terminal doesn't mean live.
      expect(getProjectStatus(activity({ openTabs: [{ id: 't' } as never] }))).toBe('idle')
    })
  })

  describe('getRailBackground', () => {
    it('returns a gradient for live + expanded projects', () => {
      expect(getRailBackground('live', true)).toContain('linear-gradient')
    })

    it('returns a subtle track for live + collapsed (chip carries signal)', () => {
      expect(getRailBackground('live', false)).toBe('var(--dplex-text-muted)')
    })

    it('returns a subtle track for idle projects (preserves alignment)', () => {
      expect(getRailBackground('idle', false)).toBe('var(--dplex-text-muted)')
      expect(getRailBackground('idle', true)).toBe('var(--dplex-text-muted)')
    })
  })

  describe('getAvatarColor', () => {
    it('is deterministic for the same id', () => {
      expect(getAvatarColor('proj-abc')).toEqual(getAvatarColor('proj-abc'))
    })

    it('yields different colors for different ids (usually)', () => {
      const a = getAvatarColor('proj-aaa')
      const b = getAvatarColor('proj-zzz')
      // Can't guarantee difference for 2 random ids, but these two should land in different buckets.
      expect(a).not.toEqual(b)
    })

    it('returns both bg and fg as non-empty strings', () => {
      const c = getAvatarColor('x')
      expect(c.bg).toMatch(/rgba/)
      expect(c.fg).toMatch(/^#/)
    })
  })

  describe('getAvatarInitials', () => {
    it('uses first two initials of space-separated names', () => {
      expect(getAvatarInitials('graph api')).toBe('GA')
    })

    it('splits dot-separated scoped names', () => {
      expect(getAvatarInitials('InE.AlertsApiService')).toBe('IA')
    })

    it('splits camelCase', () => {
      expect(getAvatarInitials('publicGraphApi')).toBe('PG')
    })

    it('splits PascalCase', () => {
      expect(getAvatarInitials('SuppressionRules')).toBe('SR')
    })

    it('falls back to first two chars for short names', () => {
      expect(getAvatarInitials('dp')).toBe('DP')
    })

    it('handles empty name', () => {
      expect(getAvatarInitials('')).toBe('?')
    })
  })
})
