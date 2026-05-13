import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_TAG_LENGTH,
  TAG_PALETTE,
  collectTagCounts,
  getTagColor,
  normalizeTag,
  normalizeTags,
  projectHasTag
} from '../../src/renderer/src/utils/projectTags'
import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import type { Project } from '../../src/renderer/src/types'

interface SettingsMock {
  getAll: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
}

let settingsMock: SettingsMock

function installWindow(): void {
  settingsMock = {
    getAll: vi.fn().mockResolvedValue({}),
    merge: vi.fn().mockResolvedValue(undefined)
  }
  ;(globalThis as { window?: unknown }).window = {
    dplex: { settings: settingsMock }
  }
}

function makeProject(id: string, tags?: string[]): Project {
  return {
    id,
    name: id,
    path: `/p/${id}`,
    addedAt: new Date().toISOString(),
    ...(tags ? { tags } : {})
  } as Project
}

beforeEach(() => {
  installWindow()
  useProjectStore.setState({ projects: [], activeProjectId: null, loaded: false } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeTag', () => {
  it('strips leading `#`, lowercases, and trims', () => {
    expect(normalizeTag('  #Infra ')).toBe('infra')
  })

  it('replaces whitespace with `-`', () => {
    expect(normalizeTag('client acme')).toBe('client-acme')
  })

  it('drops disallowed characters', () => {
    expect(normalizeTag('foo/bar!')).toBe('foobar')
  })

  it('keeps dots, underscores, dashes', () => {
    expect(normalizeTag('node.js_v18-lts')).toBe('node.js_v18-lts')
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('###')).toBeNull()
  })

  it('truncates to MAX_TAG_LENGTH', () => {
    const long = 'a'.repeat(MAX_TAG_LENGTH + 20)
    expect(normalizeTag(long)).toHaveLength(MAX_TAG_LENGTH)
  })

  it('handles non-string input gracefully', () => {
    expect(normalizeTag(undefined as unknown as string)).toBeNull()
  })
})

describe('normalizeTags', () => {
  it('dedupes and sorts alphabetically', () => {
    expect(normalizeTags(['#B', 'a', 'A', 'b'])).toEqual(['a', 'b'])
  })

  it('returns [] for empty/undefined/null', () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags([])).toEqual([])
  })

  it('skips entries that normalize to empty', () => {
    expect(normalizeTags(['', '#', 'real'])).toEqual(['real'])
  })
})

describe('collectTagCounts', () => {
  it('aggregates counts and sorts by frequency then alpha', () => {
    const projects: Project[] = [
      makeProject('a', ['infra', 'backend']),
      makeProject('b', ['infra']),
      makeProject('c', ['frontend', 'infra']),
      makeProject('d')
    ]
    expect(collectTagCounts(projects)).toEqual([
      { tag: 'infra', count: 3 },
      { tag: 'backend', count: 1 },
      { tag: 'frontend', count: 1 }
    ])
  })

  it('returns [] when no project has tags', () => {
    expect(collectTagCounts([makeProject('a'), makeProject('b')])).toEqual([])
  })
})

describe('projectHasTag', () => {
  it('matches exact stored tag', () => {
    expect(projectHasTag(makeProject('a', ['infra']), 'infra')).toBe(true)
    expect(projectHasTag(makeProject('a', ['infra']), 'frontend')).toBe(false)
    expect(projectHasTag(makeProject('a'), 'infra')).toBe(false)
  })
})

describe('getTagColor', () => {
  it('returns the override entry when it exists in the palette', () => {
    const violet = TAG_PALETTE.find((c) => c.id === 'violet')!
    expect(getTagColor('anything', 'violet')).toEqual(violet)
  })

  it('falls back to a hashed default when no override is set', () => {
    const a = getTagColor('infra')
    const b = getTagColor('infra')
    expect(a).toBe(b)
    // Different tags should be free to hash to different swatches; the
    // important invariant is that a tag is stable across calls (above).
    expect(TAG_PALETTE).toContain(a)
  })

  it('ignores unknown override ids and falls back to default', () => {
    const fallback = getTagColor('infra')
    expect(getTagColor('infra', 'no-such-color')).toBe(fallback)
  })

  it('treats null/undefined override the same as no override', () => {
    const def = getTagColor('infra')
    expect(getTagColor('infra', null)).toBe(def)
    expect(getTagColor('infra', undefined)).toBe(def)
  })
})

describe('projectStore tag actions', () => {
  it('setProjectTags normalizes and persists', () => {
    useProjectStore.setState({
      projects: [makeProject('p1')]
    } as never)

    useProjectStore.getState().setProjectTags('p1', ['#Infra', 'backend', 'Infra'])

    const p = useProjectStore.getState().projects[0]
    expect(p.tags).toEqual(['backend', 'infra'])
    expect(settingsMock.merge).toHaveBeenCalledWith({
      projects: expect.arrayContaining([expect.objectContaining({ tags: ['backend', 'infra'] })])
    })
  })

  it('setProjectTags with empty list clears the tags field', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', ['infra'])]
    } as never)

    useProjectStore.getState().setProjectTags('p1', [])

    const p = useProjectStore.getState().projects[0]
    expect(p.tags).toBeUndefined()
  })

  it('setProjectTags is a no-op when normalized result is unchanged', () => {
    // Tags are already stored in the normalized (sorted) form that
    // setProjectTags produces, so re-applying equivalent input should not
    // touch the projects array or trigger a persist call.
    useProjectStore.setState({
      projects: [makeProject('p1', ['backend', 'infra'])]
    } as never)
    const before = useProjectStore.getState().projects

    settingsMock.merge.mockClear()
    useProjectStore.getState().setProjectTags('p1', ['Backend', '#infra'])

    expect(useProjectStore.getState().projects).toBe(before)
    expect(settingsMock.merge).not.toHaveBeenCalled()
  })

  it('addProjectTag is idempotent', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', ['infra'])]
    } as never)

    useProjectStore.getState().addProjectTag('p1', '#infra')
    useProjectStore.getState().addProjectTag('p1', 'backend')

    expect(useProjectStore.getState().projects[0].tags).toEqual(['backend', 'infra'])
  })

  it('removeProjectTag removes a tag and clears the field if last', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', ['infra'])]
    } as never)

    useProjectStore.getState().removeProjectTag('p1', '#Infra')

    expect(useProjectStore.getState().projects[0].tags).toBeUndefined()
  })

  it('addProjectTag with garbage input is a no-op', () => {
    useProjectStore.setState({
      projects: [makeProject('p1')]
    } as never)

    useProjectStore.getState().addProjectTag('p1', '   ')

    expect(useProjectStore.getState().projects[0].tags).toBeUndefined()
  })

  it('tag actions on a missing project are no-ops', () => {
    useProjectStore.setState({ projects: [] } as never)
    expect(() => useProjectStore.getState().setProjectTags('missing', ['x'])).not.toThrow()
    expect(() => useProjectStore.getState().addProjectTag('missing', 'x')).not.toThrow()
    expect(() => useProjectStore.getState().removeProjectTag('missing', 'x')).not.toThrow()
  })
})
