import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ACTIVITY_BAR_ORDER,
  reconcileActivityBarOrder,
  reorderActivityBar
} from '../../src/renderer/src/utils/activityBarOrder'
import type { ActivityBarId } from '../../src/renderer/src/types'

const FULL: ActivityBarId[] = ['spaces', 'projects', 'sessions', 'explorer', 'git', 'search']

describe('DEFAULT_ACTIVITY_BAR_ORDER', () => {
  it('leads with Spaces and contains each view exactly once', () => {
    expect(DEFAULT_ACTIVITY_BAR_ORDER[0]).toBe('spaces')
    expect([...DEFAULT_ACTIVITY_BAR_ORDER].sort()).toEqual([...FULL].sort())
  })
})

describe('reconcileActivityBarOrder', () => {
  it('falls back to the canonical order when nothing is saved', () => {
    expect(reconcileActivityBarOrder(undefined)).toEqual([...DEFAULT_ACTIVITY_BAR_ORDER])
    expect(reconcileActivityBarOrder(null)).toEqual([...DEFAULT_ACTIVITY_BAR_ORDER])
    expect(reconcileActivityBarOrder([])).toEqual([...DEFAULT_ACTIVITY_BAR_ORDER])
  })

  it('preserves a complete, valid custom order verbatim', () => {
    const custom: ActivityBarId[] = ['git', 'search', 'spaces', 'projects', 'sessions', 'explorer']
    expect(reconcileActivityBarOrder(custom)).toEqual(custom)
  })

  it('drops unknown ids', () => {
    const saved = ['spaces', 'bogus', 'projects'] as unknown as ActivityBarId[]
    expect(reconcileActivityBarOrder(saved)).toEqual([
      'spaces',
      'projects',
      // remaining canonical ids appended in canonical order
      'sessions',
      'explorer',
      'git',
      'search'
    ])
  })

  it('de-duplicates repeated ids', () => {
    const saved: ActivityBarId[] = ['spaces', 'spaces', 'projects', 'projects']
    const result = reconcileActivityBarOrder(saved)
    expect(result.slice(0, 2)).toEqual(['spaces', 'projects'])
    expect([...result].sort()).toEqual([...FULL].sort())
    expect(result).toHaveLength(FULL.length)
  })

  it('appends canonical ids missing from a partial saved order', () => {
    expect(reconcileActivityBarOrder(['git'])).toEqual([
      'git',
      'spaces',
      'projects',
      'sessions',
      'explorer',
      'search'
    ])
  })
})

describe('reorderActivityBar', () => {
  it('moves an item before the target', () => {
    // projects (idx 1) before spaces (idx 0) → projects leads
    expect(reorderActivityBar(FULL, 'projects', 'spaces', 'before')).toEqual([
      'projects',
      'spaces',
      'sessions',
      'explorer',
      'git',
      'search'
    ])
  })

  it('moves an item after the target', () => {
    // spaces after projects → projects leads, spaces second
    expect(reorderActivityBar(FULL, 'spaces', 'projects', 'after')).toEqual([
      'projects',
      'spaces',
      'sessions',
      'explorer',
      'git',
      'search'
    ])
  })

  it('can move an item to the very end via after on the last item', () => {
    expect(reorderActivityBar(FULL, 'spaces', 'search', 'after')).toEqual([
      'projects',
      'sessions',
      'explorer',
      'git',
      'search',
      'spaces'
    ])
  })

  it('keeps every id exactly once regardless of direction', () => {
    const result = reorderActivityBar(FULL, 'search', 'spaces', 'before')
    expect([...result].sort()).toEqual([...FULL].sort())
    expect(result[0]).toBe('search')
  })

  it('no-ops (returns a copy) when dropping onto itself', () => {
    const result = reorderActivityBar(FULL, 'git', 'git', 'before')
    expect(result).toEqual([...FULL])
    expect(result).not.toBe(FULL)
  })

  it('no-ops when an id is not present', () => {
    const result = reorderActivityBar(FULL, 'bogus' as ActivityBarId, 'spaces')
    expect(result).toEqual([...FULL])
  })
})
