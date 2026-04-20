import { describe, expect, it } from 'vitest'
import { parsePorcelain } from '../../src/main/services/worktrees/gitWorktree'

describe('parsePorcelain', () => {
  it('returns an empty array for empty input', () => {
    expect(parsePorcelain('')).toEqual([])
  })

  it('parses a single worktree on a branch', () => {
    const out = [
      'worktree /repo',
      'HEAD abcdef1234567890',
      'branch refs/heads/main',
      ''
    ].join('\n')
    expect(parsePorcelain(out)).toEqual([
      {
        path: '/repo',
        head: 'abcdef1234567890',
        branch: 'main',
        detached: false,
        bare: false,
        prunable: false
      }
    ])
  })

  it('parses multiple worktrees separated by blank lines', () => {
    const out = [
      'worktree /repo',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD bbbbbbb',
      'branch refs/heads/feature/auth',
      ''
    ].join('\n')
    const records = parsePorcelain(out)
    expect(records).toHaveLength(2)
    expect(records[0].path).toBe('/repo')
    expect(records[0].branch).toBe('main')
    expect(records[1].path).toBe('/repo-feature')
    expect(records[1].branch).toBe('feature/auth')
  })

  it('marks detached worktrees as detached and clears branch', () => {
    const out = ['worktree /repo-detached', 'HEAD ccc', 'detached', ''].join('\n')
    const [rec] = parsePorcelain(out)
    expect(rec.detached).toBe(true)
    expect(rec.branch).toBeNull()
  })

  it('marks bare repositories', () => {
    const out = ['worktree /repo.git', 'HEAD 0000000', 'bare', ''].join('\n')
    const [rec] = parsePorcelain(out)
    expect(rec.bare).toBe(true)
  })

  it('marks prunable worktrees', () => {
    const out = [
      'worktree /repo-prune',
      'HEAD ddd',
      'branch refs/heads/old',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n')
    const [rec] = parsePorcelain(out)
    expect(rec.prunable).toBe(true)
  })

  it('emits the final record even without a trailing blank line', () => {
    const out = ['worktree /repo', 'HEAD abc', 'branch refs/heads/main'].join('\n')
    const records = parsePorcelain(out)
    expect(records).toHaveLength(1)
    expect(records[0].path).toBe('/repo')
  })

  it('preserves multi-segment branch names', () => {
    const out = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/feature/sub/part',
      ''
    ].join('\n')
    const [rec] = parsePorcelain(out)
    expect(rec.branch).toBe('feature/sub/part')
  })

  it('keeps non-refs/heads/ branch refs as-is', () => {
    const out = ['worktree /repo', 'HEAD abc', 'branch refs/tags/v1', ''].join('\n')
    const [rec] = parsePorcelain(out)
    expect(rec.branch).toBe('refs/tags/v1')
  })

  it('ignores stray lines outside any record', () => {
    const out = ['junk-line', '', 'worktree /repo', 'HEAD abc', ''].join('\n')
    const records = parsePorcelain(out)
    expect(records).toHaveLength(1)
    expect(records[0].path).toBe('/repo')
  })
})
