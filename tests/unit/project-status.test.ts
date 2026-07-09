import { describe, expect, it } from 'vitest'
import {
  deriveAvatarColor,
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

  describe('deriveAvatarColor', () => {
    it('returns a neutral grey (theme tokens) when no colour is set', () => {
      const c = deriveAvatarColor(undefined)
      expect(c.bg).toBe('var(--dplex-bg-elev-2)')
      expect(c.fg).toBe('var(--dplex-text-dim)')
      expect(c.border).toBe('var(--dplex-border)')
    })

    it('derives a same-hue tint from the given colour', () => {
      const c = deriveAvatarColor('#F87171')
      expect(c.fg).toBe('#F87171')
      expect(c.bg).toBe('#F8717126')
      expect(c.border).toBe('#F871715C')
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
