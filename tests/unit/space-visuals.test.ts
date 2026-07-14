import { describe, expect, it } from 'vitest'
import { glyphFor, spaceInitials } from '../../src/renderer/src/components/spaces/spaceVisuals'
import type { Space } from '../../src/renderer/src/types'

describe('spaceInitials', () => {
  it('derives up to two uppercase initials', () => {
    expect(spaceInitials('Ship OAuth')).toBe('SO')
    expect(spaceInitials('perf')).toBe('P')
    expect(spaceInitials('fix flaky ci tests')).toBe('FF')
  })

  it('falls back to "S" for an empty/whitespace name', () => {
    expect(spaceInitials('   ')).toBe('S')
    expect(spaceInitials('')).toBe('S')
  })
})

describe('glyphFor', () => {
  it('uses an explicit glyph when present', () => {
    expect(glyphFor({ name: 'Ship OAuth', glyph: '★' })).toBe('★')
  })

  it('falls back to initials for a missing or blank glyph', () => {
    expect(glyphFor({ name: 'Ship OAuth', glyph: undefined })).toBe('SO')
    expect(glyphFor({ name: 'Ship OAuth', glyph: '   ' })).toBe('SO')
  })

  it('does not crash on a non-string glyph from a hand-edited/corrupt file', () => {
    // glyph is typed as string | undefined, but a malformed on-disk file could
    // carry a number; glyphFor must guard rather than call .trim() on it.
    const space = { name: 'Weird', glyph: 42 } as unknown as Pick<Space, 'name' | 'glyph'>
    expect(glyphFor(space)).toBe('W')
  })
})
