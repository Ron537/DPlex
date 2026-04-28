/**
 * Unit tests for the .gitignore-aware matcher used by `changesWatcher` to
 * filter fs events. Spawns no git processes; works against tmp directories
 * with handcrafted `.gitignore` files.
 */

import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildGitignoreMatcher,
  rewritePatterns
} from '../../src/main/services/diff/gitignoreMatcher'

let tmp: string

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-gitignore-'))
  await fsp.mkdir(path.join(tmp, '.git'), { recursive: true })
})

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true })
})

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(tmp, rel)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')
}

describe('buildGitignoreMatcher — built-ins', () => {
  it('always ignores .git/, .DS_Store, and editor swap files', () => {
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('.git/index')).toBe(true)
    expect(m.ignores('.DS_Store')).toBe(true)
    expect(m.ignores('subdir/.DS_Store')).toBe(true)
    expect(m.ignores('foo.swp')).toBe(true)
    expect(m.ignores('subdir/foo.swo')).toBe(true)
    expect(m.ignores('foo~')).toBe(true)
  })

  it('does not ignore unrelated files when no .gitignore present', () => {
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('src/index.ts')).toBe(false)
    expect(m.ignores('README.md')).toBe(false)
  })
})

describe('buildGitignoreMatcher — root .gitignore', () => {
  it('honors directory and glob patterns', async () => {
    await write('.gitignore', ['node_modules/', 'dist/', '*.log', '.cache'].join('\n'))
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('node_modules/foo/bar.js')).toBe(true)
    expect(m.ignores('dist/index.js')).toBe(true)
    expect(m.ignores('app.log')).toBe(true)
    expect(m.ignores('subdir/app.log')).toBe(true)
    expect(m.ignores('.cache/foo')).toBe(true)
    expect(m.ignores('src/main.ts')).toBe(false)
  })

  it('honors negation', async () => {
    await write('.gitignore', ['*.log', '!important.log'].join('\n'))
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('app.log')).toBe(true)
    expect(m.ignores('important.log')).toBe(false)
  })

  it('skips comments and blank lines', async () => {
    await write('.gitignore', ['# comment', '', 'dist/', '   ', '# another'].join('\n'))
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('dist/foo')).toBe(true)
  })
})

describe('buildGitignoreMatcher — nested .gitignore', () => {
  it('scopes nested patterns to their directory', async () => {
    // Root has nothing; subpkg has its own .gitignore.
    await write('subpkg/.gitignore', 'out/\n')
    await fsp.mkdir(path.join(tmp, 'subpkg', 'out'), { recursive: true })
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('subpkg/out/file.js')).toBe(true)
    // Root-level out/ should NOT be ignored (the rule lives in subpkg/).
    expect(m.ignores('out/file.js')).toBe(false)
  })

  it('does not descend into already-ignored subtrees (perf guard)', async () => {
    // Root ignores node_modules. We put a (nonsensical) .gitignore inside it
    // that, IF we descended, would also ignore `keepme.txt` at root. The
    // matcher MUST NOT honor that file because we should never enter
    // node_modules during the walk.
    await write('.gitignore', 'node_modules/\n')
    await write('node_modules/.gitignore', '/keepme.txt\n')
    await write('keepme.txt', '')
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('node_modules/foo')).toBe(true)
    expect(m.ignores('keepme.txt')).toBe(false)
  })

  it('honors bare-name patterns at any depth under the nested dir', async () => {
    await write('subpkg/.gitignore', '*.log\n')
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('subpkg/app.log')).toBe(true)
    expect(m.ignores('subpkg/deep/nested/app.log')).toBe(true)
    expect(m.ignores('app.log')).toBe(false)
  })
})

describe('buildGitignoreMatcher — info/exclude', () => {
  it('reads .git/info/exclude', async () => {
    await write('.git/info/exclude', 'localnotes/\n*.tmp\n')
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('localnotes/foo')).toBe(true)
    expect(m.ignores('foo.tmp')).toBe(true)
    expect(m.ignores('subdir/foo.tmp')).toBe(true)
  })

  it('follows the gitdir + commondir pointer for linked worktrees', async () => {
    // Simulate a linked worktree: `.git` is a FILE; the gitdir contains a
    // `commondir` file pointing at the shared git directory. The shared
    // directory is the only place `info/exclude` lives.
    const wt = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-wt-'))
    try {
      const main = path.join(wt, 'main')
      const linked = path.join(wt, 'linked')
      const sharedGit = path.join(main, '.git')
      const wtGitDir = path.join(sharedGit, 'worktrees', 'lk')
      await fsp.mkdir(path.join(sharedGit, 'info'), { recursive: true })
      await fsp.writeFile(path.join(sharedGit, 'info', 'exclude'), 'shared-only/\n')
      await fsp.mkdir(wtGitDir, { recursive: true })
      // A `commondir` pointer that doesn't match the simple ../.. heuristic.
      await fsp.writeFile(path.join(wtGitDir, 'commondir'), sharedGit + '\n')
      await fsp.mkdir(linked, { recursive: true })
      await fsp.writeFile(path.join(linked, '.git'), `gitdir: ${wtGitDir}\n`)
      const m = buildGitignoreMatcher(linked)
      expect(m.ignores('shared-only/foo')).toBe(true)
    } finally {
      await fsp.rm(wt, { recursive: true, force: true })
    }
  })
})

describe('rewritePatterns', () => {
  it('returns root-level patterns unchanged', () => {
    expect(rewritePatterns('foo\n*.log\n!keep.log\n', '')).toEqual(['foo', '*.log', '!keep.log'])
  })

  it('anchors leading-slash patterns to relDir', () => {
    expect(rewritePatterns('/build\n', 'pkg')).toEqual(['pkg/build'])
  })

  it('anchors slash-bearing patterns to relDir', () => {
    expect(rewritePatterns('foo/bar\n', 'pkg')).toEqual(['pkg/foo/bar'])
  })

  it('expands bare-name patterns to match any descendant under relDir', () => {
    expect(rewritePatterns('*.log\n', 'pkg')).toEqual(['pkg/**/*.log'])
  })

  it('preserves negation prefix', () => {
    expect(rewritePatterns('!keep.log\n', 'pkg')).toEqual(['!pkg/**/keep.log'])
  })

  it('drops blanks and comments', () => {
    expect(rewritePatterns('\n# comment\nfoo\n', 'pkg')).toEqual(['pkg/**/foo'])
  })

  it('preserves escaped trailing whitespace (matcher actually ignores `foo `)', async () => {
    // `foo\ ` should ignore filenames literally ending with a space. We keep
    // the backslash escape because the `ignore` package consumes raw
    // gitignore syntax (verified via end-to-end matcher.ignores).
    await write('.gitignore', 'foo\\ \n')
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('foo ')).toBe(true)
    expect(m.ignores('foo')).toBe(false)
  })

  it('strips unescaped trailing whitespace', () => {
    expect(rewritePatterns('foo   \n', '')).toEqual(['foo'])
    expect(rewritePatterns('foo\t\t\n', '')).toEqual(['foo'])
  })

  it('treats an even number of trailing backslashes before a space as unescaped', () => {
    // `foo\\ ` — the backslash escapes itself, so the trailing space IS
    // unescaped and should be trimmed.
    expect(rewritePatterns('foo\\\\ \n', '')).toEqual(['foo\\\\'])
  })
})

describe('buildGitignoreMatcher — robustness', () => {
  it('returns a usable matcher when repo has unreadable subdirs', async () => {
    // Just exercises the readdir failure path — the matcher should still
    // include the always-ignore set.
    const bogus = path.join(tmp, 'does', 'not', 'exist')
    const m = buildGitignoreMatcher(bogus)
    expect(m.ignores('.git/index')).toBe(true)
    expect(m.ignores('foo.swp')).toBe(true)
  })

  it('handles a `.gitignore` file at repo root that is unreadable', async () => {
    // Write directory in place of the file — read should fail and we should
    // still get a working matcher with built-ins.
    await fsp.mkdir(path.join(tmp, '.gitignore'), { recursive: true })
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('.git/index')).toBe(true)
  })

  it('walks deeply nested trees up to the depth cap without throwing', async () => {
    // 12 levels deep — beyond MAX_WALK_DEPTH (10). Just verify no throw.
    let cur = tmp
    for (let i = 0; i < 12; i++) {
      cur = path.join(cur, 'd' + i)
      await fsp.mkdir(cur, { recursive: true })
    }
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('.git/index')).toBe(true)
  })

  it('rejects symlinked .gitignore files (security: no follow)', async () => {
    // Symlink targets are user-controlled; we lstat and require a regular file.
    const target = path.join(tmp, 'evil-target')
    await fsp.writeFile(target, 'should-not-load/\n')
    try {
      await fsp.symlink(target, path.join(tmp, '.gitignore'))
    } catch {
      return // skip on systems that don't allow symlinks
    }
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('should-not-load/foo')).toBe(false)
    // Built-ins still active.
    expect(m.ignores('.git/index')).toBe(true)
  })

  it('rejects oversized .gitignore files (DoS guard)', async () => {
    // 2 MiB > MAX_GITIGNORE_BYTES (1 MiB).
    const big = 'pattern-that-should-not-load/\n'.repeat(80_000)
    await fsp.writeFile(path.join(tmp, '.gitignore'), big)
    const m = buildGitignoreMatcher(tmp)
    expect(m.ignores('pattern-that-should-not-load/foo')).toBe(false)
    expect(m.ignores('.git/index')).toBe(true)
  })
})

describe('buildGitignoreMatcher — input normalization', () => {
  it('does not throw on path inputs the matcher receives from fs.watch', async () => {
    await write('.gitignore', 'dist/\n')
    const m = buildGitignoreMatcher(tmp)
    // POSIX style (already normalized by changesWatcher) is what we feed.
    expect(m.ignores('dist/index.js')).toBe(true)
  })
})
