import { describe, expect, it } from 'vitest'
import { expandPattern, slugifyBranch } from '../../src/renderer/src/utils/worktreePath'

describe('slugifyBranch', () => {
  it('replaces slashes with dashes', () => {
    expect(slugifyBranch('feature/auth')).toBe('feature-auth')
  })

  it('preserves dots, dashes and underscores', () => {
    expect(slugifyBranch('release/1.2.3')).toBe('release-1.2.3')
    expect(slugifyBranch('fix_my-thing')).toBe('fix_my-thing')
  })

  it('strips diacritics down to ascii', () => {
    // 'é' normalizes to 'e' + combining acute, the combining mark is stripped.
    expect(slugifyBranch('héllo/wörld')).toBe('hello-world')
  })

  it('lowercases the result', () => {
    expect(slugifyBranch('Feature/AUTH')).toBe('feature-auth')
  })

  it('trims leading and trailing dashes from non-alnum runs', () => {
    expect(slugifyBranch('   weird name   ')).toBe('weird-name')
    expect(slugifyBranch('//edge//')).toBe('edge')
  })

  it('returns an empty string for fully-stripped input', () => {
    expect(slugifyBranch('   ')).toBe('')
    expect(slugifyBranch('!!!')).toBe('')
  })
})

describe('expandPattern', () => {
  it('substitutes both placeholders', () => {
    expect(expandPattern('../{project}-{branch}', 'dplex', 'feature/auth')).toBe(
      '../dplex-feature-auth'
    )
  })

  it('repeats placeholder substitution', () => {
    expect(expandPattern('{branch}/{branch}', 'p', 'foo')).toBe('foo/foo')
  })

  it('leaves the pattern intact when no placeholders are present', () => {
    expect(expandPattern('/tmp/static', 'dplex', 'main')).toBe('/tmp/static')
  })

  it('slugifies the branch on the way through', () => {
    expect(expandPattern('wt/{branch}', 'p', 'Feature/Auth')).toBe('wt/feature-auth')
  })

  it('does not slugify the project name', () => {
    expect(expandPattern('{project}/wt', 'My Project', 'main')).toBe('My Project/wt')
  })
})
