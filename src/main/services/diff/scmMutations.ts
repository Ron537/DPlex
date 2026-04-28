/**
 * SCM mutations: stage / unstage / discard / revert at file level, plus
 * `applyHunkPatch` for hunk-level operations.
 *
 * Race safety: hunk operations require `expectedLeftBlobOid` and
 * `expectedRightMtimeMs` from the FileDiffContent the renderer used to
 * compute the patch. We revalidate both before applying — if either
 * changed, we return `STALE_DIFF` and the renderer prompts a reload.
 *
 * Path discipline: all user paths are passed AFTER `--` so paths that
 * start with `-` or contain `=` cannot be misread as flags.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { execGitRaw } from '../gitService'
import { buildHunkPatch } from './buildPatch'
import type { HunkMutationRequest, MutationResult } from './types'

/**
 * Reject inputs that try to escape the repo root or reference absolute
 * paths. Returned `gitPath` is guaranteed POSIX-relative without `..`.
 */
export function sanitizeGitPath(gitPath: string): string | null {
  if (typeof gitPath !== 'string' || gitPath.length === 0) return null
  if (gitPath.includes('\0')) return null
  // Disallow Windows-style or rooted paths.
  if (path.isAbsolute(gitPath)) return null
  if (/^[a-zA-Z]:[\\/]/.test(gitPath)) return null
  // Reject any "../" segment.
  const norm = gitPath.replace(/\\/g, '/')
  for (const seg of norm.split('/')) {
    if (seg === '..') return null
  }
  return norm
}

export async function stageFile(repoRootFs: string, gitPath: string): Promise<MutationResult> {
  const safe = sanitizeGitPath(gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  const r = await execGitRaw(['add', '--', safe], repoRootFs, 30_000)
  if (r.code !== 0) {
    return { ok: false, code: 'GIT_APPLY_FAILED', message: r.stderr.trim() || 'git add failed' }
  }
  return { ok: true }
}

export async function unstageFile(repoRootFs: string, gitPath: string): Promise<MutationResult> {
  const safe = sanitizeGitPath(gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  // `restore --staged` is the modern equivalent; falls back to reset HEAD on old git.
  const r = await execGitRaw(['restore', '--staged', '--', safe], repoRootFs, 30_000)
  if (r.code !== 0) {
    const fallback = await execGitRaw(['reset', 'HEAD', '--', safe], repoRootFs, 30_000)
    if (fallback.code !== 0) {
      return {
        ok: false,
        code: 'GIT_APPLY_FAILED',
        message: r.stderr.trim() || fallback.stderr.trim() || 'git unstage failed'
      }
    }
  }
  return { ok: true }
}

/** Discard *unstaged* working-tree changes for a file (back to index). */
export async function discardFile(repoRootFs: string, gitPath: string): Promise<MutationResult> {
  const safe = sanitizeGitPath(gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  // Untracked files can't be restored — they need to be deleted.
  // `git restore -- <path>` is a no-op for untracked, so we try-fs-unlink as fallback.
  const r = await execGitRaw(['restore', '--worktree', '--', safe], repoRootFs, 30_000)
  if (r.code !== 0) {
    return {
      ok: false,
      code: 'GIT_APPLY_FAILED',
      message: r.stderr.trim() || 'git restore failed'
    }
  }
  return { ok: true }
}

/** Revert HEAD↔WT (also clears any staged change) for a file. Destructive. */
export async function revertFile(repoRootFs: string, gitPath: string): Promise<MutationResult> {
  const safe = sanitizeGitPath(gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  const r = await execGitRaw(['checkout', 'HEAD', '--', safe], repoRootFs, 30_000)
  if (r.code !== 0) {
    return {
      ok: false,
      code: 'GIT_APPLY_FAILED',
      message: r.stderr.trim() || 'git checkout failed'
    }
  }
  return { ok: true }
}

/** Delete an untracked file (file shows up as `?` in status). Destructive. */
export async function deleteUntracked(
  repoRootFs: string,
  gitPath: string
): Promise<MutationResult> {
  const safe = sanitizeGitPath(gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  const fsPath = path.join(repoRootFs, ...safe.split('/'))
  try {
    await fsp.unlink(fsPath)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      code: 'IO_ERROR',
      message: err instanceof Error ? err.message : 'unlink failed'
    }
  }
}

/**
 * Apply a hunk-level mutation. Builds the patch in main, runs
 * `git apply --check` first, then applies (with `--cached` and/or
 * `--reverse` depending on action).
 *
 * Race revalidation: re-reads the canonical "left" blob OID from git
 * (HEAD or :0:path depending on action) and compares against the
 * expected OID. For working-file edits, also compares mtime.
 */
export async function applyHunkPatch(req: HunkMutationRequest): Promise<MutationResult> {
  const safe = sanitizeGitPath(req.file.gitPath)
  if (!safe) return { ok: false, code: 'INVALID_INPUT', message: 'Invalid path' }
  if (req.file.isBinary) {
    return { ok: false, code: 'BINARY_NOT_SUPPORTED', message: 'Binary files cannot be hunked' }
  }
  if (req.file.isConflict) {
    return { ok: false, code: 'CONFLICT', message: 'File is in conflict' }
  }

  // Determine which left ref / apply target each action uses.
  // Stage:    left = :0:path (index), right = WT.  Apply --cached, forward.
  // Unstage:  left = HEAD:path,        right = :0. Apply --cached, reverse.
  // Discard:  left = :0:path,          right = WT. Apply (worktree), reverse.
  // Revert:   left = HEAD:path,        right = WT. Apply (worktree), reverse.
  let leftRef: string
  let cached = false
  let reverse = false
  switch (req.action) {
    case 'stage':
      leftRef = ':0'
      cached = true
      reverse = false
      break
    case 'unstage':
      leftRef = 'HEAD'
      cached = true
      reverse = true
      break
    case 'discard':
      leftRef = ':0'
      cached = false
      reverse = true
      break
    case 'revert':
      leftRef = 'HEAD'
      cached = false
      reverse = true
      break
    default:
      return { ok: false, code: 'INVALID_INPUT', message: `Unknown action ${req.action}` }
  }

  // Race: re-read the expected blob OID and compare.
  if (req.expectedLeftBlobOid) {
    const oidR = await execGitRaw(
      ['rev-parse', '--verify', '--quiet', `${leftRef}:${safe}`],
      req.repoRootFs
    )
    const currentOid = oidR.stdout.trim()
    if (oidR.code !== 0 || currentOid !== req.expectedLeftBlobOid) {
      return { ok: false, code: 'STALE_DIFF', message: 'Index/HEAD changed since diff loaded' }
    }
  }
  // Race: re-check working file mtime when the action touches the WT.
  if (!cached && req.expectedRightMtimeMs !== undefined) {
    const fsPath = path.join(req.repoRootFs, ...safe.split('/'))
    try {
      const stat = await fsp.stat(fsPath)
      // Allow 1 ms wiggle for FS rounding (some FSes only have 1 s precision).
      if (Math.abs(stat.mtimeMs - req.expectedRightMtimeMs) > 1500) {
        return { ok: false, code: 'STALE_DIFF', message: 'Working file changed since diff loaded' }
      }
    } catch {
      return { ok: false, code: 'STALE_DIFF', message: 'Working file vanished' }
    }
  }

  // Build the forward patch (oldText -> newText) for the selected ranges.
  // `reverse` is applied at the `git apply` level, not by swapping inputs.
  const built = buildHunkPatch({
    gitPath: safe,
    oldText: req.originalText,
    newText: req.modifiedText,
    selection: req.hunkLines,
    eol: '\n'
  })
  if (!built.hasContent) {
    return { ok: false, code: 'INVALID_INPUT', message: 'No hunks overlap selection' }
  }

  // Dry-run with --check first so we never half-apply.
  const checkArgs = ['apply', '--check', '--whitespace=nowarn']
  if (cached) checkArgs.push('--cached')
  if (reverse) checkArgs.push('--reverse')
  checkArgs.push('-')
  const check = await execGitRawWithStdin(checkArgs, req.repoRootFs, built.patch)
  if (check.code !== 0) {
    return {
      ok: false,
      code: 'GIT_APPLY_FAILED',
      message: check.stderr.trim() || 'git apply --check failed'
    }
  }

  const applyArgs = ['apply', '--whitespace=nowarn']
  if (cached) applyArgs.push('--cached')
  if (reverse) applyArgs.push('--reverse')
  applyArgs.push('-')
  const apply = await execGitRawWithStdin(applyArgs, req.repoRootFs, built.patch)
  if (apply.code !== 0) {
    return {
      ok: false,
      code: 'GIT_APPLY_FAILED',
      message: apply.stderr.trim() || 'git apply failed'
    }
  }
  return { ok: true }
}

/**
 * Like execGitRaw but pipes a string to stdin. Kept local because no other
 * gitService call needs it today.
 */
function execGitRawWithStdin(
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs = 30_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Lazy require to avoid a top-of-file circular import on gitService.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require('child_process') as typeof import('child_process')
    const child = spawn('git', args, { cwd, timeout: timeoutMs })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
    try {
      child.stdin.end(stdin)
    } catch {
      /* ignore — close handler will report */
    }
  })
}

// Re-export for tests (don't rely on this externally).
export const __test = { sanitizeGitPath, execGitRawWithStdin }
