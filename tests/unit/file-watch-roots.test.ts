/**
 * Unit tests for the bound↔canonical watch-root mapping that lets tree-changed
 * events match a project opened under a symlinked path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  setCanonicalRoot,
  clearCanonicalRoot,
  watchRootMatches
} from '../../src/renderer/src/stores/fileWatchRoots'

afterEach(() => {
  clearCanonicalRoot('/proj')
  clearCanonicalRoot('/tmp/proj')
})

describe('watchRootMatches', () => {
  it('matches an identical bound root', () => {
    expect(watchRootMatches('/proj', '/proj')).toBe(true)
  })

  it('matches the canonical root recorded for a bound root', () => {
    setCanonicalRoot('/tmp/proj', '/private/tmp/proj')
    expect(watchRootMatches('/private/tmp/proj', '/tmp/proj')).toBe(true)
  })

  it('does not match an unrelated root', () => {
    setCanonicalRoot('/tmp/proj', '/private/tmp/proj')
    expect(watchRootMatches('/somewhere/else', '/tmp/proj')).toBe(false)
  })

  it('returns false for a null bound root', () => {
    expect(watchRootMatches('/private/tmp/proj', null)).toBe(false)
  })

  it('stops matching after the mapping is cleared', () => {
    setCanonicalRoot('/tmp/proj', '/private/tmp/proj')
    clearCanonicalRoot('/tmp/proj')
    expect(watchRootMatches('/private/tmp/proj', '/tmp/proj')).toBe(false)
  })
})
