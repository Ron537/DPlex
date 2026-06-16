/**
 * Real-git integration tests for the commit-graph readers and commit-scope
 * diffs. Spawns actual `git` against tmp repos so topology, ref decoration,
 * rename detection, and root-commit handling are validated end-to-end.
 *
 * Skipped on Windows CI (left to the e2e suite), like diff-integration.
 */

import { execFile } from 'child_process'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getCommitFiles, getCommitGraph } from '../../src/main/services/diff/commitGraph'
import { fileDiffContent } from '../../src/main/services/diff/diffService'
import type { ChangedFile } from '../../src/main/services/diff/types'

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
  repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-graph-it-'))
  await gitOk(['init', '-q', '-b', 'main'])
  await gitOk(['config', 'user.email', 'test@dplex.local'])
  await gitOk(['config', 'user.name', 'DPlex Test'])
  await gitOk(['config', 'core.autocrlf', 'false'])
  await gitOk(['config', 'commit.gpgsign', 'false'])
})

afterEach(async () => {
  await fsp.rm(repo, { recursive: true, force: true }).catch(() => {})
})

async function commit(message: string): Promise<string> {
  await gitOk(['add', '-A'])
  await gitOk(['commit', '-q', '-m', message, '--allow-empty'])
  return (await gitOk(['rev-parse', 'HEAD'])).trim()
}

describe('getCommitGraph (real git)', () => {
  skipOnWindows('returns commits newest-first with parents and subjects', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\n')
    const c1 = await commit('first')
    await fsp.writeFile(path.join(repo, 'a.txt'), 'two\n')
    const c2 = await commit('second')

    const res = await getCommitGraph(repo, { limit: 10 })
    expect(res.commits.length).toBe(2)
    expect(res.hasMore).toBe(false)
    // Newest first.
    expect(res.commits[0].sha).toBe(c2)
    expect(res.commits[1].sha).toBe(c1)
    expect(res.commits[0].subject).toBe('second')
    // c2's parent is c1; c1 is a root.
    expect(res.commits[0].parents).toEqual([c1])
    expect(res.commits[1].parents).toEqual([])
    expect(res.commits[0].authorName).toBe('DPlex Test')
    expect(res.commits[0].authorDate).toBeGreaterThan(0)
  })

  skipOnWindows('decorates branch + tag refs on the right commits', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\n')
    await commit('first')
    await gitOk(['tag', 'v1.0.0'])

    const res = await getCommitGraph(repo, { limit: 10 })
    const head = res.commits[0]
    const refNames = head.refs.map((r) => r.name)
    expect(refNames).toContain('HEAD')
    expect(refNames).toContain('main')
    expect(head.refs.some((r) => r.kind === 'tag' && r.name === 'v1.0.0')).toBe(true)
  })

  skipOnWindows('paginates with skip + limit and reports hasMore', async () => {
    for (let i = 0; i < 5; i++) {
      await fsp.writeFile(path.join(repo, 'a.txt'), `v${i}\n`)
      await commit(`c${i}`)
    }
    const page1 = await getCommitGraph(repo, { limit: 2, skip: 0 })
    expect(page1.commits.length).toBe(2)
    expect(page1.hasMore).toBe(true)

    const page2 = await getCommitGraph(repo, { limit: 2, skip: 2 })
    expect(page2.commits.length).toBe(2)
    // No overlap between pages.
    const overlap = page1.commits.some((c) => page2.commits.some((d) => d.sha === c.sha))
    expect(overlap).toBe(false)
  })

  skipOnWindows('captures merge commits with two parents', async () => {
    await fsp.writeFile(path.join(repo, 'base.txt'), 'base\n')
    const base = await commit('base')
    await gitOk(['checkout', '-q', '-b', 'feature'])
    await fsp.writeFile(path.join(repo, 'feat.txt'), 'feat\n')
    await commit('feature work')
    await gitOk(['checkout', '-q', 'main'])
    await fsp.writeFile(path.join(repo, 'main.txt'), 'main\n')
    await commit('main work')
    await gitOk(['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature'])

    const res = await getCommitGraph(repo, { limit: 20 })
    const merge = res.commits.find((c) => c.subject === 'Merge feature')
    expect(merge).toBeDefined()
    expect(merge!.parents.length).toBe(2)
    // base appears once with no parent.
    const baseCommit = res.commits.find((c) => c.sha === base)
    expect(baseCommit!.parents).toEqual([])
  })
})

describe('getCommitFiles (real git)', () => {
  skipOnWindows('lists files changed by a normal commit', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\n')
    await commit('first')
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n')
    await fsp.writeFile(path.join(repo, 'b.txt'), 'new\n')
    const sha = await commit('second')

    const res = await getCommitFiles(repo, sha)
    const byPath = Object.fromEntries(res.files.map((f) => [f.gitPath, f]))
    expect(byPath['a.txt']).toMatchObject({ headStatus: 'M' })
    expect(byPath['b.txt']).toMatchObject({ headStatus: 'A' })
  })

  skipOnWindows('treats a root commit as all-additions', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\n')
    await fsp.writeFile(path.join(repo, 'b.txt'), 'two\n')
    const root = await commit('root')

    const res = await getCommitFiles(repo, root)
    const paths = res.files.map((f) => f.gitPath).sort()
    expect(paths).toEqual(['a.txt', 'b.txt'])
    expect(res.files.every((f) => f.headStatus === 'A')).toBe(true)
  })

  skipOnWindows('detects renames within a commit', async () => {
    await fsp.writeFile(path.join(repo, 'old.txt'), 'alpha\nbeta\ngamma\n')
    await commit('first')
    await gitOk(['mv', 'old.txt', 'new.txt'])
    const sha = await commit('rename')

    const res = await getCommitFiles(repo, sha)
    const rename = res.files.find((f) => f.gitPath === 'new.txt')
    expect(rename).toBeDefined()
    expect(rename!.headStatus).toBe('R')
    expect(rename!.oldGitPath).toBe('old.txt')
  })

  skipOnWindows('shows first-parent changes for a merge commit', async () => {
    await fsp.writeFile(path.join(repo, 'base.txt'), 'base\n')
    await commit('base')
    await gitOk(['checkout', '-q', '-b', 'feature'])
    await fsp.writeFile(path.join(repo, 'feat.txt'), 'feat\n')
    await commit('feature work')
    await gitOk(['checkout', '-q', 'main'])
    // A change on mainline (first parent) that must NOT appear in the merge's
    // first-parent diff.
    await fsp.writeFile(path.join(repo, 'main-only.txt'), 'main\n')
    await commit('main work')
    await gitOk(['merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature'])
    const mergeSha = (await gitOk(['rev-parse', 'HEAD'])).trim()

    const res = await getCommitFiles(repo, mergeSha)
    const paths = res.files.map((f) => f.gitPath)
    // Relative to the first parent (main), the merge brings in feat.txt only.
    expect(paths).toContain('feat.txt')
    // main-only.txt already existed in the first parent — must be excluded.
    expect(paths).not.toContain('main-only.txt')
  })
})

describe('fileDiffContent (commit scope, real git)', () => {
  function fileOf(files: ChangedFile[], gitPath: string): ChangedFile {
    const f = files.find((x) => x.gitPath === gitPath)
    if (!f) throw new Error(`missing ${gitPath}`)
    return f
  }

  skipOnWindows('diffs a modified file against its parent', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n')
    await commit('first')
    await fsp.writeFile(path.join(repo, 'a.txt'), 'one\nTWO\nthree\n')
    const sha = await commit('second')

    const files = (await getCommitFiles(repo, sha)).files
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'commit', sha },
      file: fileOf(files, 'a.txt')
    })
    expect(content.leftText).toBe('one\ntwo\n')
    expect(content.rightText).toBe('one\nTWO\nthree\n')
    expect(content.leftIsEmpty).toBe(false)
    expect(content.rightIsEmpty).toBe(false)
  })

  skipOnWindows('shows empty left for a file added in a root commit', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'hello\n')
    const root = await commit('root')

    const files = (await getCommitFiles(repo, root)).files
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'commit', sha: root },
      file: fileOf(files, 'a.txt')
    })
    expect(content.leftIsEmpty).toBe(true)
    expect(content.rightText).toBe('hello\n')
  })

  skipOnWindows('shows empty right for a deleted file', async () => {
    await fsp.writeFile(path.join(repo, 'a.txt'), 'gone\n')
    await commit('first')
    await fsp.rm(path.join(repo, 'a.txt'))
    const sha = await commit('delete')

    const files = (await getCommitFiles(repo, sha)).files
    const content = await fileDiffContent({
      repoRootFs: repo,
      scope: { kind: 'commit', sha },
      file: fileOf(files, 'a.txt')
    })
    expect(content.leftText).toBe('gone\n')
    expect(content.rightIsEmpty).toBe(true)
  })
})
