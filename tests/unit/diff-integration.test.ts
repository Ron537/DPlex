/**
 * Real-git integration tests for the diff viewer's main-process services.
 * Spawns actual `git` against tmp repos so patch round-trips, EOL handling,
 * and porcelain v2 are validated end-to-end.
 *
 * Skipped when `git` is unavailable or on Windows CI (left to the e2e suite).
 */

import { execFile } from 'child_process'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listChanges, fileDiffContent } from '../../src/main/services/diff/diffService'
import {
  applyHunkPatch,
  discardFile,
  stageFile,
  unstageFile
} from '../../src/main/services/diff/scmMutations'
import { buildHunkPatch } from '../../src/main/services/diff/buildPatch'

function git(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code
        resolve({
          code: typeof code === 'number' ? code : 1,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? err.message ?? '')
        })
      } else {
        resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    })
  })
}

let repo = ''

async function gitOk(args: string[], cwd = repo): Promise<string> {
  const r = await git(args, cwd)
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.code}): ${r.stderr}`)
  }
  return r.stdout
}

const skipOnWindows = process.platform === 'win32' ? it.skip : it

beforeEach(async () => {
  repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-diff-it-'))
  await gitOk(['init', '-q', '-b', 'main'])
  await gitOk(['config', 'user.email', 'test@dplex.local'])
  await gitOk(['config', 'user.name', 'DPlex Test'])
  await gitOk(['config', 'core.autocrlf', 'false'])
  await gitOk(['config', 'commit.gpgsign', 'false'])
})

afterEach(async () => {
  await fsp.rm(repo, { recursive: true, force: true }).catch(() => {})
})

async function commit(message: string): Promise<void> {
  await gitOk(['add', '-A'])
  await gitOk(['commit', '-q', '-m', message, '--allow-empty'])
}

describe('listChanges (working tree, real git)', () => {
  skipOnWindows('reports modified + untracked + staged separately', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\nTWO\nthree\n')
    await fsp.writeFile(path.join(repo, 'b.txt'), 'new file\n')
    await gitOk(['add', 'b.txt'])

    const result = await listChanges(repo, { kind: 'workingTree' })
    const byPath = Object.fromEntries(result.files.map((f) => [f.gitPath, f]))
    expect(byPath['a.txt']).toMatchObject({ headStatus: '.', wtStatus: 'M' })
    expect(byPath['b.txt']).toMatchObject({ headStatus: 'A', wtStatus: '.' })
    expect(result.truncated).toBe(false)
  })

  skipOnWindows('detects rename via porcelain v2', async () => {
    await fsp.writeFile(path.join(repo, 'old.txt'), 'alpha\nbeta\ngamma\n')
    await commit('init')
    await fsp.rename(path.join(repo, 'old.txt'), path.join(repo, 'new.txt'))
    await gitOk(['add', '-A'])

    const result = await listChanges(repo, { kind: 'workingTree' })
    const renamed = result.files.find((f) => f.gitPath === 'new.txt')
    expect(renamed).toBeDefined()
    expect(renamed?.oldGitPath).toBe('old.txt')
    expect(renamed?.headStatus).toBe('R')
  })
})

describe('fileDiffContent (real git)', () => {
  skipOnWindows('returns index↔WT pair with blob OID and mtime for unstaged change', async () => {
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nb\nc\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nB\nc\n')

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!

    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })
    expect(content.leftRef).toBe('index')
    expect(content.rightRef).toBe('WORKTREE')
    expect(content.leftText).toBe('a\nb\nc\n')
    expect(content.rightText).toBe('a\nB\nc\n')
    expect(content.leftBlobOid).toMatch(/^[0-9a-f]{40}$/)
    expect(content.rightMtimeMs).toBeTypeOf('number')
  })

  skipOnWindows('returns left empty for untracked file', async () => {
    await fsp.writeFile(path.join(repo, 'seed.txt'), 'x\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'new.txt'), 'fresh\n')

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'new.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })
    expect(content.leftIsEmpty).toBe(true)
    expect(content.leftText).toBe('')
    expect(content.rightText).toBe('fresh\n')
  })

  skipOnWindows('returns HEAD↔index pair when staged=true', async () => {
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nb\nc\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nB\nc\n')
    await gitOk(['add', 'f.txt'])

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: true
    })
    expect(content.leftRef).toBe('HEAD')
    expect(content.rightRef).toBe('index')
    expect(content.leftText).toBe('a\nb\nc\n')
    expect(content.rightText).toBe('a\nB\nc\n')
  })
})

describe('buildHunkPatch + applyHunkPatch (real git)', () => {
  skipOnWindows('stages a single hunk while leaving another unstaged', async () => {
    const original = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\n'
    const modified = 'L1\nL2\nCHANGED-3\nL4\nL5\nL6\nL7\nCHANGED-8\nL9\nL10\n'
    await fsp.writeFile(path.join(repo, 'f.txt'), original)
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), modified)

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })

    // Stage ONLY line 3 (the first change), leave line 8 unstaged.
    const result = await applyHunkPatch({
      repoRootFs: repo,
      action: 'stage',
      file: f,
      originalText: content.leftText,
      modifiedText: content.rightText,
      hunkLines: [{ startLine: 3, endLine: 3 }],
      expectedLeftBlobOid: content.leftBlobOid,
      expectedRightMtimeMs: content.rightMtimeMs
    })
    expect(result).toEqual({ ok: true })

    // Index should have line 3 changed, line 8 still original.
    const indexContent = await gitOk(['show', ':0:f.txt'])
    expect(indexContent).toContain('CHANGED-3')
    expect(indexContent).toContain('L8\n')
    expect(indexContent).not.toContain('CHANGED-8')

    // Working tree still has both changes.
    const wt = await fsp.readFile(path.join(repo, 'f.txt'), 'utf8')
    expect(wt).toBe(modified)
  })

  skipOnWindows('rejects with STALE_DIFF when working file changed since diff load', async () => {
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nb\nc\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nB\nc\n')

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })

    // Mutate WT after capture, far enough to clear the 1.5s mtime tolerance.
    await new Promise((r) => setTimeout(r, 1700))
    await fsp.writeFile(path.join(repo, 'f.txt'), 'a\nB\nC-extra\n')

    const result = await applyHunkPatch({
      repoRootFs: repo,
      action: 'discard',
      file: f,
      originalText: content.leftText,
      modifiedText: content.rightText,
      hunkLines: [{ startLine: 2, endLine: 2 }],
      expectedLeftBlobOid: content.leftBlobOid,
      expectedRightMtimeMs: content.rightMtimeMs
    })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('STALE_DIFF')
  })

  skipOnWindows('round-trips a CRLF hunk (preserves line endings)', async () => {
    const original = 'L1\r\nL2\r\nL3\r\n'
    const modified = 'L1\r\nL2-changed\r\nL3\r\n'
    await fsp.writeFile(path.join(repo, 'f.txt'), original)
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), modified)

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })
    expect(content.eol).toBe('\r\n')

    const result = await applyHunkPatch({
      repoRootFs: repo,
      action: 'stage',
      file: f,
      originalText: content.leftText,
      modifiedText: content.rightText,
      hunkLines: [{ startLine: 2, endLine: 2 }],
      expectedLeftBlobOid: content.leftBlobOid,
      expectedRightMtimeMs: content.rightMtimeMs
    })
    expect(result).toEqual({ ok: true })
    // After staging, index should match the modified bytes exactly.
    const indexBytes = await gitOk(['show', ':0:f.txt'])
    expect(indexBytes).toBe(modified)
  })
})

describe('full-file mutations (real git)', () => {
  skipOnWindows('stage / unstage / discard', async () => {
    await fsp.writeFile(path.join(repo, 'f.txt'), 'one\n')
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), 'two\n')

    expect((await stageFile(repo, 'f.txt')).ok).toBe(true)
    let porcelain = await gitOk(['status', '--porcelain'])
    expect(porcelain).toBe('M  f.txt\n')

    expect((await unstageFile(repo, 'f.txt')).ok).toBe(true)
    porcelain = await gitOk(['status', '--porcelain'])
    expect(porcelain).toBe(' M f.txt\n')

    expect((await discardFile(repo, 'f.txt')).ok).toBe(true)
    const wt = await fsp.readFile(path.join(repo, 'f.txt'), 'utf8')
    expect(wt).toBe('one\n')
  })

  skipOnWindows('rejects path traversal', async () => {
    const r = await stageFile(repo, '../escape.txt')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('INVALID_INPUT')
  })

  skipOnWindows('rejects absolute paths', async () => {
    const r = await stageFile(repo, '/etc/passwd')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('INVALID_INPUT')
  })
})

describe('buildHunkPatch (pure)', () => {
  it('returns hasContent=false when selection misses all hunks', () => {
    const out = buildHunkPatch({
      gitPath: 'f.txt',
      oldText: 'a\nb\nc\n',
      newText: 'a\nB\nc\n',
      selection: [{ startLine: 100, endLine: 200 }],
      eol: '\n'
    })
    expect(out.hasContent).toBe(false)
    expect(out.patch).toBe('')
  })

  it('emits "\\ No newline at end of file" when newText lacks trailing newline', () => {
    const out = buildHunkPatch({
      gitPath: 'f.txt',
      oldText: 'a\nb\nc\n',
      newText: 'a\nB\nc',
      selection: [{ startLine: 1, endLine: 3 }],
      eol: '\n'
    })
    expect(out.hasContent).toBe(true)
    expect(out.patch).toContain('+c\n\\ No newline at end of file\n')
  })

  it('emits the marker on both sides when neither ends with newline', () => {
    const out = buildHunkPatch({
      gitPath: 'f.txt',
      oldText: 'a\nb\nc',
      newText: 'a\nB\nc',
      selection: [{ startLine: 1, endLine: 3 }],
      eol: '\n'
    })
    expect(out.hasContent).toBe(true)
    const markerCount = (out.patch.match(/\\ No newline at end of file/g) ?? []).length
    expect(markerCount).toBeGreaterThanOrEqual(1)
  })

  it('emits a git-apply-shaped header', () => {
    const out = buildHunkPatch({
      gitPath: 'src/a.ts',
      oldText: 'x\ny\nz\n',
      newText: 'x\nY\nz\n',
      selection: [{ startLine: 1, endLine: 3 }],
      eol: '\n'
    })
    expect(out.patch.startsWith('diff --git a/src/a.ts b/src/a.ts\n')).toBe(true)
    expect(out.patch).toContain('--- a/src/a.ts')
    expect(out.patch).toContain('+++ b/src/a.ts')
    expect(out.patch).toMatch(/^@@ -\d+,?\d* \+\d+,?\d* @@/m)
  })
})

describe('applyHunkPatch with no-newline-at-end-of-file (real git)', () => {
  skipOnWindows('round-trips a file whose last line lacks a trailing newline', async () => {
    const original = 'L1\nL2\nL3'
    const modified = 'L1\nL2-changed\nL3'
    await fsp.writeFile(path.join(repo, 'f.txt'), original)
    await commit('init')
    await fsp.writeFile(path.join(repo, 'f.txt'), modified)

    const list = await listChanges(repo, { kind: 'workingTree' })
    const f = list.files.find((x) => x.gitPath === 'f.txt')!
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'workingTree' },
      file: f,
      staged: false
    })

    const result = await applyHunkPatch({
      repoRootFs: repo,
      action: 'stage',
      file: f,
      originalText: content.leftText,
      modifiedText: content.rightText,
      hunkLines: [{ startLine: 2, endLine: 2 }],
      expectedLeftBlobOid: content.leftBlobOid,
      expectedRightMtimeMs: content.rightMtimeMs
    })
    expect(result).toEqual({ ok: true })
    const indexBytes = await gitOk(['show', ':0:f.txt'])
    expect(indexBytes).toBe(modified)
  })
})
