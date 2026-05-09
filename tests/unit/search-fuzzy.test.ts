import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyMatchAny } from '../../src/renderer/src/services/search/fuzzyMatch'

describe('fuzzyMatch', () => {
  it('returns zero-score match for empty query', () => {
    const r = fuzzyMatch('hello', '')
    expect(r).not.toBeNull()
    expect(r!.score).toBe(0)
    expect(r!.ranges).toEqual([])
  })

  it('returns null when text is empty but query is not', () => {
    expect(fuzzyMatch('', 'foo')).toBeNull()
  })

  it('returns null when query characters are not all present in order', () => {
    expect(fuzzyMatch('abc', 'cba')).toBeNull()
    expect(fuzzyMatch('hello', 'xyz')).toBeNull()
  })

  it('matches a substring and returns its range', () => {
    const r = fuzzyMatch('Open Settings', 'Set')
    expect(r).not.toBeNull()
    expect(r!.ranges).toEqual([{ start: 5, end: 8 }])
  })

  it('case-insensitive matching', () => {
    const r = fuzzyMatch('Hello World', 'world')
    expect(r).not.toBeNull()
    expect(r!.ranges).toEqual([{ start: 6, end: 11 }])
  })

  it('prefix matches outscore middle matches', () => {
    const prefix = fuzzyMatch('foobar', 'foo')!
    const middle = fuzzyMatch('barfoo', 'foo')!
    expect(prefix.score).toBeGreaterThan(middle.score)
  })

  it('exact substring matches outscore subsequence matches', () => {
    const sub = fuzzyMatch('settings', 'sett')!
    const seq = fuzzyMatch('something tiny truly', 'sett')!
    expect(sub.score).toBeGreaterThan(seq.score)
  })

  it('produces correct ranges for subsequence matches', () => {
    const r = fuzzyMatch('add new project', 'anp')!
    // a@0, n@4, p@8
    expect(r.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
      { start: 8, end: 9 }
    ])
  })

  it('rewards consecutive runs in subsequence matches', () => {
    const consecutive = fuzzyMatch('foo bar baz', 'fb')!
    const scattered = fuzzyMatch('xfxbxxx', 'fb')!
    // Both match by subsequence; consecutive boundaries should win.
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('merges adjacent ranges produced by consecutive matches', () => {
    const r = fuzzyMatch('abc def', 'abc')!
    expect(r.ranges).toEqual([{ start: 0, end: 3 }])
  })
})

describe('fuzzyMatchAny', () => {
  it('falls back to keyword match when label does not match', () => {
    const m = fuzzyMatchAny('Theme', ['color', 'palette'], 'palette')
    expect(m).not.toBeNull()
    // Keyword-only matches return empty ranges — they only contribute to score.
    expect(m!.ranges).toEqual([])
  })

  it('prefers label match over keyword match', () => {
    // Both label and keyword match — label match must win (it has ranges).
    const m = fuzzyMatchAny('Theme', ['theme'], 'theme')
    expect(m).not.toBeNull()
    expect(m!.ranges.length).toBeGreaterThan(0)
  })

  it('returns null when neither label nor keywords match', () => {
    expect(fuzzyMatchAny('Theme', ['color', 'palette'], 'xyz')).toBeNull()
  })
})
