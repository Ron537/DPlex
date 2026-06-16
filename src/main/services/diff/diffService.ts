/**
 * Read-side of the diff viewer feature: list changed files for a scope and
 * fetch left/right text for a single file.
 *
 * No mutation here — see `scmMutations.ts` for stage/discard/apply.
 *
 * Path discipline:
 *  - All git invocations use `gitPath` (POSIX, repo-relative) AFTER `--`.
 *  - Working-file reads use `fsPath = path.join(repoRootFs, ...gitPath.split('/'))`.
 *  - `repoRootFs` is treated as already-realpath'd by the IPC layer.
 */

import * as fsp from 'fs/promises'
import * as path from 'path'
import { execGitRaw } from '../gitService'
import { getCommitFiles } from './commitGraph'
import { parseNameStatusZ, parsePorcelainV2 } from './porcelainV2'
import type {
  ChangedFile,
  ChangeListResult,
  DiffScope,
  FileDiffContent,
  FileDiffRequest,
  RepoStatus
} from './types'

/** Hard cap on number of files returned by listChanges. */
export const MAX_FILES = 5000
/** Hard cap on per-side content size for fileDiffContent (2 MB). */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024
/** Bytes to sniff when detecting EOL / binary. */
const SNIFF_BYTES = 4096

/**
 * Resolve a user-provided branch base to a real git ref.
 * Tries `<base>`, then `origin/<base>`, then `origin/HEAD` (default branch).
 * Returns null if nothing resolves.
 */
export async function resolveBranchBase(repoRootFs: string, base: string): Promise<string | null> {
  const tryRefs = [base, `origin/${base}`, 'origin/HEAD']
  for (const ref of tryRefs) {
    const r = await execGitRaw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRootFs)
    if (r.code === 0 && r.stdout.trim().length > 0) return ref
  }
  return null
}

/**
 * List changed files for a scope. Returns BOTH staged + unstaged rows for
 * working-tree scope (caller groups by headStatus / wtStatus). Branch scope
 * returns a flat list keyed off headStatus.
 */
export async function listChanges(repoRootFs: string, scope: DiffScope): Promise<ChangeListResult> {
  if (scope.kind === 'workingTree') {
    // `--no-optional-locks` prevents `git status` from rewriting the index
    // stat cache, which would otherwise touch `.git/index` and trigger our
    // file-watcher → infinite refresh loop.
    const r = await execGitRaw(
      [
        '--no-optional-locks',
        'status',
        '--porcelain=v2',
        '-z',
        '--untracked-files=all',
        '--renames'
      ],
      repoRootFs,
      30_000
    )
    if (r.code !== 0) {
      return { files: [], truncated: false, totalCount: 0 }
    }
    const all = parsePorcelainV2(r.stdout)
    return capList(all)
  }

  // commit
  if (scope.kind === 'commit') {
    return getCommitFiles(repoRootFs, scope.sha)
  }

  // branch
  const resolved = scope.resolvedRef ?? (await resolveBranchBase(repoRootFs, scope.base))
  if (!resolved) return { files: [], truncated: false, totalCount: 0 }
  const r = await execGitRaw(
    ['diff', '--name-status', '-z', '--find-renames', `${resolved}...HEAD`],
    repoRootFs,
    30_000
  )
  if (r.code !== 0) return { files: [], truncated: false, totalCount: 0 }
  const all = parseNameStatusZ(r.stdout)
  return capList(all)
}

function capList(all: ChangedFile[]): ChangeListResult {
  if (all.length <= MAX_FILES) {
    return { files: all, truncated: false, totalCount: all.length }
  }
  return { files: all.slice(0, MAX_FILES), truncated: true, totalCount: all.length }
}

/**
 * Cheap repo-status probe used by the Git panel to render an empty/error
 * state. Does NOT enumerate files. The caller is expected to have already
 * canonicalised `repoRootFs`; we tolerate non-existent paths gracefully.
 *
 * Decision tree (in order):
 *  1. Path missing on disk        → `missing-path`
 *  2. Not a git repo / worktree   → `not-a-repo`
 *  3. `.git/MERGE_HEAD` exists    → `merge`
 *  4. rebase dir exists           → `rebase`
 *  5. HEAD is detached            → `detached-head`
 *  6. Otherwise                   → `ok` (with `headRef`)
 *
 * `git rev-parse` failures fall back to `error` with the stderr text.
 */
export async function getRepoStatus(repoRootFs: string): Promise<RepoStatus> {
  // 1. Path existence
  try {
    const st = await fsp.stat(repoRootFs)
    if (!st.isDirectory()) return { kind: 'missing-path' }
  } catch {
    return { kind: 'missing-path' }
  }

  // 2. Is this a git repo / linked worktree? `git rev-parse --git-dir` is
  //    cheap and returns the resolved gitdir for both regular repos and
  //    linked worktrees (which point into `.git/worktrees/<name>`).
  const gitDirRes = await execGitRaw(['rev-parse', '--git-dir'], repoRootFs, 5_000)
  if (gitDirRes.code !== 0) {
    return { kind: 'not-a-repo' }
  }
  const gitDirRel = gitDirRes.stdout.trim()
  if (!gitDirRel) return { kind: 'not-a-repo' }
  const gitDirAbs = path.isAbsolute(gitDirRel) ? gitDirRel : path.join(repoRootFs, gitDirRel)

  // 3-4. In-progress operation files. We probe the per-worktree gitdir.
  const probe = async (rel: string): Promise<boolean> => {
    try {
      await fsp.access(path.join(gitDirAbs, rel))
      return true
    } catch {
      return false
    }
  }
  if (await probe('MERGE_HEAD')) return { kind: 'merge', operation: 'merge' }
  if (await probe('rebase-merge')) return { kind: 'rebase', operation: 'rebase' }
  if (await probe('rebase-apply')) return { kind: 'rebase', operation: 'rebase' }
  if (await probe('CHERRY_PICK_HEAD')) {
    return { kind: 'cherry-pick', operation: 'cherry-pick' }
  }
  if (await probe('BISECT_LOG')) return { kind: 'bisect', operation: 'bisect' }

  // 5. Detached vs branch.
  const symRef = await execGitRaw(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRootFs, 5_000)
  if (symRef.code === 0) {
    const headRef = symRef.stdout.trim() || undefined
    return { kind: 'ok', headRef }
  }

  // Detached — try to surface the short SHA so the UI can display something.
  const head = await execGitRaw(['rev-parse', '--short', '--verify', 'HEAD'], repoRootFs, 5_000)
  if (head.code === 0) {
    const sha = head.stdout.trim() || undefined
    return { kind: 'detached-head', isDetached: true, headRef: sha }
  }

  // No HEAD at all — likely an initial-commit repo. We treat this as `ok`
  // with no headRef so the panel just shows "no changes" rather than an
  // error banner.
  return { kind: 'ok' }
}

/**
 * Probe a working file's size/EOL/binary-ness without loading the whole thing.
 */
async function sniffWorkingFile(
  fsPath: string
): Promise<{ exists: boolean; size: number; eol: '\n' | '\r\n'; isBinary: boolean }> {
  try {
    const stat = await fsp.stat(fsPath)
    const fh = await fsp.open(fsPath, 'r')
    try {
      const buf = Buffer.alloc(Math.min(SNIFF_BYTES, stat.size))
      if (buf.length > 0) await fh.read(buf, 0, buf.length, 0)
      const isBinary = buf.includes(0)
      const eol: '\n' | '\r\n' = buf.includes(0x0d) ? '\r\n' : '\n'
      return { exists: true, size: stat.size, eol, isBinary }
    } finally {
      await fh.close()
    }
  } catch {
    return { exists: false, size: 0, eol: '\n', isBinary: false }
  }
}

/**
 * Read a blob from a git ref. Returns null if the path doesn't exist there.
 * Uses `git cat-file` so we get raw bytes (git show would honor textconv).
 */
async function readBlob(
  repoRootFs: string,
  ref: string,
  gitPath: string
): Promise<{ text: string; size: number; oid: string | null; isBinary: boolean } | null> {
  // Resolve to OID first so we can check size cheaply.
  const objSpec = `${ref}:${gitPath}`
  const oidR = await execGitRaw(['rev-parse', '--verify', '--quiet', objSpec], repoRootFs)
  if (oidR.code !== 0) return null
  const oid = oidR.stdout.trim() || null

  const sizeR = await execGitRaw(['cat-file', '-s', objSpec], repoRootFs)
  const size = sizeR.code === 0 ? Number.parseInt(sizeR.stdout.trim(), 10) || 0 : 0
  if (size > MAX_CONTENT_BYTES) {
    return { text: '', size, oid, isBinary: false }
  }

  const r = await execGitRaw(['cat-file', '-p', objSpec], repoRootFs, 30_000)
  if (r.code !== 0) return null
  // Heuristic: NUL byte in first 8 KB means binary.
  const sample = r.stdout.slice(0, 8192)
  const isBinary = sample.includes('\0')
  return { text: r.stdout, size, oid, isBinary }
}

async function readWorkingText(
  fsPath: string,
  size: number,
  isBinary: boolean
): Promise<{ text: string; truncated: boolean }> {
  if (isBinary) return { text: '', truncated: false }
  if (size > MAX_CONTENT_BYTES) return { text: '', truncated: true }
  try {
    const text = await fsp.readFile(fsPath, 'utf8')
    return { text, truncated: false }
  } catch {
    return { text: '', truncated: false }
  }
}

/**
 * Reject working-file reads that resolve outside the repo root via symlinks.
 * Returns the realpath if safe, or `null` if the path doesn't exist or escapes.
 *
 * Realpath's both sides for the comparison so this is robust whether or not
 * the caller passed a pre-realpath'd `repoRootFs`.
 */
async function safeRealpathInside(repoRootFs: string, fsPath: string): Promise<string | null> {
  try {
    const [realRoot, realTarget] = await Promise.all([
      fsp.realpath(repoRootFs),
      fsp.realpath(fsPath)
    ])
    const rel = path.relative(realRoot, realTarget)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return realTarget
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetch left/right content for a single file in a scope.
 *
 * Working-tree scope, `staged=true`  → left=HEAD, right=index
 * Working-tree scope, `staged=false` → left=index, right=working file
 * Branch scope                       → left=<base>, right=HEAD
 *
 * Renames use `oldGitPath` for the left side. Adds return empty left;
 * deletes return empty right.
 */
export async function fileDiffContent(req: FileDiffRequest): Promise<FileDiffContent> {
  const { repoRootFs, scope, file, staged = false } = req
  const gitPath = file.gitPath
  const oldGitPath = file.oldGitPath ?? gitPath
  const fsPath = path.join(repoRootFs, ...gitPath.split('/'))

  let leftRef = ''
  let rightRef = ''
  let leftGitPath: string | null = oldGitPath
  let rightGitPath: string | null = gitPath
  let leftText = ''
  let rightText = ''
  let leftIsEmpty = false
  let rightIsEmpty = false
  let isBinary = false
  let truncated = false
  let leftBlobOid: string | undefined
  let rightMtimeMs: number | undefined
  let eol: '\n' | '\r\n' = '\n'

  if (scope.kind === 'branch') {
    const resolved = scope.resolvedRef ?? (await resolveBranchBase(repoRootFs, scope.base))
    leftRef = resolved ?? scope.base
    rightRef = 'HEAD'
    if (file.headStatus === 'A') {
      leftIsEmpty = true
      leftGitPath = null
    } else {
      const left = await readBlob(repoRootFs, leftRef, oldGitPath)
      if (left) {
        leftText = left.text
        leftBlobOid = left.oid ?? undefined
        if (left.isBinary) isBinary = true
        if (left.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        leftIsEmpty = true
        leftGitPath = null
      }
    }
    if (file.headStatus === 'D') {
      rightIsEmpty = true
      rightGitPath = null
    } else {
      const right = await readBlob(repoRootFs, 'HEAD', gitPath)
      if (right) {
        rightText = right.text
        if (right.isBinary) isBinary = true
        if (right.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        rightIsEmpty = true
        rightGitPath = null
      }
    }
    return {
      leftRef,
      rightRef,
      leftGitPath,
      rightGitPath,
      leftText,
      rightText,
      leftIsEmpty,
      rightIsEmpty,
      isBinary,
      truncated,
      leftBlobOid,
      eol
    }
  }

  if (scope.kind === 'commit') {
    const sha = scope.sha
    const shortSha = sha.slice(0, 7)
    // Compare the commit against its first parent (`sha^`). For a root commit
    // `sha^` doesn't resolve, so readBlob returns null and the left side
    // renders empty (the file shows as a pure addition).
    leftRef = `${shortSha}^`
    rightRef = shortSha
    if (file.headStatus === 'A') {
      leftIsEmpty = true
      leftGitPath = null
    } else {
      const left = await readBlob(repoRootFs, `${sha}^`, oldGitPath)
      if (left) {
        leftText = left.text
        leftBlobOid = left.oid ?? undefined
        if (left.isBinary) isBinary = true
        if (left.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        leftIsEmpty = true
        leftGitPath = null
      }
    }
    if (file.headStatus === 'D') {
      rightIsEmpty = true
      rightGitPath = null
    } else {
      const right = await readBlob(repoRootFs, sha, gitPath)
      if (right) {
        rightText = right.text
        if (right.isBinary) isBinary = true
        if (right.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        rightIsEmpty = true
        rightGitPath = null
      }
    }
    return {
      leftRef,
      rightRef,
      leftGitPath,
      rightGitPath,
      leftText,
      rightText,
      leftIsEmpty,
      rightIsEmpty,
      isBinary,
      truncated,
      leftBlobOid,
      eol
    }
  }

  // Working-tree scope.
  if (staged) {
    leftRef = 'HEAD'
    rightRef = 'index'
    // HEAD↔index pair.
    if (file.headStatus === 'A' || file.headStatus === '?') {
      leftIsEmpty = true
      leftGitPath = null
    } else {
      const left = await readBlob(repoRootFs, 'HEAD', oldGitPath)
      if (left) {
        leftText = left.text
        leftBlobOid = left.oid ?? undefined
        if (left.isBinary) isBinary = true
        if (left.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        leftIsEmpty = true
        leftGitPath = null
      }
    }
    if (file.headStatus === 'D') {
      rightIsEmpty = true
      rightGitPath = null
    } else {
      const right = await readBlob(repoRootFs, ':0', gitPath)
      if (right) {
        rightText = right.text
        if (right.isBinary) isBinary = true
        if (right.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        rightIsEmpty = true
        rightGitPath = null
      }
    }
  } else {
    leftRef = 'index'
    rightRef = 'WORKTREE'
    // index↔WT pair.
    if (file.wtStatus === '?' || file.headStatus === 'A') {
      // Untracked or freshly-added-but-unstaged: left empty, right = WT
      leftIsEmpty = true
      leftGitPath = null
    } else {
      // Use index version (path is current, not oldGitPath, since renames
      // are recorded between HEAD and index — index↔WT uses current name).
      // Conflicted files have no stage-0 entry; fall back to stage 2 (ours)
      // and finally HEAD so the user sees a meaningful left side instead
      // of an empty pane.
      let left = await readBlob(repoRootFs, ':0', gitPath)
      if (!left && file.isConflict) {
        left =
          (await readBlob(repoRootFs, ':2', gitPath)) ??
          (await readBlob(repoRootFs, 'HEAD', gitPath))
        if (left) leftRef = 'ours'
      }
      if (left) {
        leftText = left.text
        leftBlobOid = left.oid ?? undefined
        if (left.isBinary) isBinary = true
        if (left.size > MAX_CONTENT_BYTES) truncated = true
      } else {
        leftIsEmpty = true
        leftGitPath = null
      }
    }
    if (file.wtStatus === 'D') {
      rightIsEmpty = true
      rightGitPath = null
    } else {
      const safeFsPath = await safeRealpathInside(repoRootFs, fsPath)
      if (!safeFsPath) {
        rightIsEmpty = true
        rightGitPath = null
      } else {
        const sniff = await sniffWorkingFile(safeFsPath)
        if (!sniff.exists) {
          rightIsEmpty = true
          rightGitPath = null
        } else {
          if (sniff.isBinary) isBinary = true
          eol = sniff.eol
          const wt = await readWorkingText(safeFsPath, sniff.size, sniff.isBinary)
          rightText = wt.text
          if (wt.truncated) truncated = true
          try {
            const stat = await fsp.stat(safeFsPath)
            rightMtimeMs = stat.mtimeMs
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  return {
    leftRef,
    rightRef,
    leftGitPath,
    rightGitPath,
    leftText,
    rightText,
    leftIsEmpty,
    rightIsEmpty,
    isBinary,
    truncated,
    leftBlobOid,
    rightMtimeMs,
    eol
  }
}
