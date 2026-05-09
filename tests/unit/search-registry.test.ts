import { describe, it, expect } from 'vitest'
import {
  buildRegistry,
  MAX_RESULTS_PER_GROUP
} from '../../src/renderer/src/services/search/searchRegistry'
import type {
  SearchContext,
  SearchItem,
  SearchSource
} from '../../src/renderer/src/services/search/types'

const EMPTY_CTX: SearchContext = {
  projects: [],
  sessions: [],
  groups: [],
  activeGroupId: null
}

function source(
  category: SearchItem['category'],
  items: { id: string; label: string; keywords?: string[] }[]
): SearchSource {
  return {
    category,
    getItems: () =>
      items.map((it) => ({
        id: it.id,
        category,
        label: it.label,
        keywords: it.keywords,
        run: () => undefined
      }))
  }
}

describe('SearchRegistry', () => {
  it('returns no groups when no source has items', () => {
    const reg = buildRegistry([source('commands', [])])
    expect(reg.run('foo', EMPTY_CTX)).toEqual([])
  })

  it('groups results by category and renders empty-state previews when query is empty', () => {
    const reg = buildRegistry([
      source('commands', [
        { id: 'c1', label: 'Add Project' },
        { id: 'c2', label: 'New Terminal' }
      ]),
      source('projects', [{ id: 'p1', label: 'My Project' }])
    ])
    const result = reg.run('', EMPTY_CTX)
    expect(result).toHaveLength(2)
    expect(result[0].category).toBe('commands') // commands first per CATEGORY_ORDER
    expect(result[0].items).toHaveLength(2)
    expect(result[1].category).toBe('projects')
  })

  it('ranks items by score and drops non-matches', () => {
    const reg = buildRegistry([
      source('commands', [
        { id: 'c1', label: 'Add Project' },
        { id: 'c2', label: 'New Terminal' },
        { id: 'c3', label: 'Open Settings' }
      ])
    ])
    const result = reg.run('add', EMPTY_CTX)
    expect(result).toHaveLength(1)
    expect(result[0].items[0].item.id).toBe('c1')
    // 'New Terminal' has no 'add' subsequence, so it's dropped.
    expect(result[0].items.find((r) => r.item.id === 'c2')).toBeUndefined()
  })

  it('caps results per group at MAX_RESULTS_PER_GROUP', () => {
    const lots = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      label: `setting item ${i}`
    }))
    const reg = buildRegistry([source('commands', lots)])
    const result = reg.run('setting', EMPTY_CTX)
    expect(result[0].items.length).toBe(MAX_RESULTS_PER_GROUP)
  })

  it('prunes categories that are not in the allowed list', () => {
    const reg = buildRegistry([
      source('commands', [{ id: 'c1', label: 'Add Project' }]),
      source('projects', [{ id: 'p1', label: 'Add' }])
    ])
    const result = reg.run('add', EMPTY_CTX, { categories: ['commands'] })
    expect(result).toHaveLength(1)
    expect(result[0].category).toBe('commands')
  })

  it('includes items that match only via keywords', () => {
    const reg = buildRegistry([
      source('settings', [{ id: 's1', label: 'Theme', keywords: ['color', 'dark mode'] }])
    ])
    const result = reg.run('color', EMPTY_CTX)
    expect(result).toHaveLength(1)
    expect(result[0].items[0].item.id).toBe('s1')
  })
})
