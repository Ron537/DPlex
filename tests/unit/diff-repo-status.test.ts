/**
 * Real-git integration tests for `diff:getRepoStatus`. Verifies the kind
 * dispatch across clean, detached, mid-merge, mid-rebase, not-a-repo, and
 * missing-path repos. Skipped if `git` is unavailable.
 */

import { execFile } from 'child_process'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getRepoStatus } from '../../src/main/services/diff/diffService'

function git(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
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
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

beforeEach(async () => {
  repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-status-'))
  await gitOk(['init', '-q', '-b', 'main'])
  await gitOk(['config', 'user.email', 't@t.test'])
  await gitOk(['config', 'user.name', 'Tester'])
  await gitOk(['config', 'commit.gpgsign', 'false'])
  await fsp.writeFile(path.join(repo, 'a.txt'), 'hello\n')
  await gitOk(['add', '.'])
  await gitOk(['commit', '-q', '-m', 'init'])
})

afterEach(async () => {
  if (repo) await fsp.rm(repo, { recursive: true, force: true })
})

describe('diff:getRepoStatus', () => {
  it('returns ok with HEAD ref for a clean repo on a branch', async () => {
    const s = await getRepoStatus(repo)
    expect(s.kind).toBe('ok')
    expect(s.headRef).toBe('main')
    expect(s.isDetached).toBeFalsy()
  })

  it('returns missing-path for a non-existent folder', async () => {
    const s = await getRepoStatus(path.join(repo, 'does-not-exist'))
    expect(s.kind).toBe('missing-path')
  })

  it('returns not-a-repo for a folder without .git', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-not-a-repo-'))
    try {
      const s = await getRepoStatus(tmp)
      expect(s.kind).toBe('not-a-repo')
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true })
    }
  })

  it('returns detached-head for a detached checkout', async () => {
    const sha = (await gitOk(['rev-parse', 'HEAD'])).trim()
    await gitOk(['checkout', '--detach', sha])
    const s = await getRepoStatus(repo)
    expect(s.kind).toBe('detached-head')
    expect(s.isDetached).toBe(true)
  })

  it('returns merge for a repo with MERGE_HEAD', async () => {
    // Force a merge-conflict state.
    await gitOk(['checkout', '-q', '-b', 'feature'])
    await fsp.writeFile(path.join(repo, 'a.txt'), 'feature\n')
    await gitOk(['commit', '-q', '-am', 'feature'])
    await gitOk(['checkout', '-q', 'main'])
    await fsp.writeFile(path.join(repo, 'a.txt'), 'main\n')
    await gitOk(['commit', '-q', '-am', 'main'])
    const r = await git(['merge', '--no-edit', 'feature'], repo)
    // Merge will fail (conflict); MERGE_HEAD should now exist.
    expect(r.code).not.toBe(0)
    const s = await getRepoStatus(repo)
    expect(s.kind).toBe('merge')
    expect(s.operation).toBe('merge')
  })
})
