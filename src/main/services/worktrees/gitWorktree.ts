/**
 * Thin wrappers around `git worktree` + `git status` / `git rev-list` that return
 * structured data. No caching and no watchers here — those live in `service.ts`.
 */

import {
  execGitRaw,
  realpath,
  getUpstream,
  getRepoIdentity,
  isMainCheckout,
  revListAheadBehind
} from '../gitService'
import type { WorktreeInfo, WorktreeStatus } from './types'
import { getEntriesForRepo } from './sidecar'

/**
 * Parse `git worktree list --porcelain` output.
 *
 * Porcelain format (one record per worktree, records separated by blank line):
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<branch>   (or "detached")
 *   [bare]                       (top-level bare repo, we skip this in v1)
 *   [prunable <reason>]
 *   [locked <reason>]
 */
interface RawWorktreeRecord {
  path: string
  head: string
  branch: string | null
  detached: boolean
  bare: boolean
  prunable: boolean
}

function parsePorcelainImpl(output: string): RawWorktreeRecord[] {
  const records: RawWorktreeRecord[] = []
  let cur: Partial<RawWorktreeRecord> | null = null

  const flush = (): void => {
    if (cur && cur.path) {
      records.push({
        path: cur.path,
        head: cur.head ?? '',
        branch: cur.branch ?? null,
        detached: cur.detached ?? false,
        bare: cur.bare ?? false,
        prunable: cur.prunable ?? false
      })
    }
    cur = null
  }

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length) }
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      cur.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
      cur.detached = false
    } else if (line === 'detached') {
      cur.branch = null
      cur.detached = true
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line.startsWith('prunable')) {
      cur.prunable = true
    }
  }
  flush()
  return records
}

/**
 * Exported for unit testing. Parses `git worktree list --porcelain` output into
 * structured records.
 */
export function parsePorcelain(output: string): RawWorktreeRecord[] {
  return parsePorcelainImpl(output)
}

export type { RawWorktreeRecord }

/**
 * Returns true if the given directory is inside a valid git repo (worktree or main).
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  const res = await execGitRaw(['rev-parse', '--is-inside-work-tree'], dirPath, 3000)
  if (res.code !== 0) return false
  return res.stdout.trim() === 'true'
}

/**
 * Compute dirty/staged/untracked counts from `git status --porcelain=v1`.
 * Fast: one command per worktree.
 */
async function readStatusCounts(
  worktreePath: string
): Promise<Pick<WorktreeStatus, 'dirtyCount' | 'untrackedCount' | 'stagedCount'>> {
  const res = await execGitRaw(['status', '--porcelain=v1'], worktreePath, 5000)
  if (res.code !== 0) {
    return { dirtyCount: null, untrackedCount: null, stagedCount: null }
  }
  let dirty = 0
  let staged = 0
  let untracked = 0
  for (const line of res.stdout.split('\n')) {
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') {
      untracked++
      continue
    }
    if (x !== ' ' && x !== '?') staged++
    if (y !== ' ' && y !== '?') dirty++
  }
  return { dirtyCount: dirty, untrackedCount: untracked, stagedCount: staged }
}

/**
 * Enrich a single raw worktree record with status + sidecar data.
 * Returns a finalized WorktreeInfo.
 */
async function enrich(
  _repoRoot: string,
  raw: RawWorktreeRecord,
  sidecar: Map<string, import('./sidecar').WorktreeSidecarEntry>
): Promise<WorktreeInfo> {
  const canonical = await realpath(raw.path)

  const [counts, upstream] = await Promise.all([
    readStatusCounts(canonical),
    raw.branch ? getUpstream(canonical, raw.branch) : Promise.resolve(null)
  ])

  let ahead: number | null = null
  let behind: number | null = null
  if (raw.branch && upstream) {
    const res = await revListAheadBehind(canonical, upstream, raw.branch)
    ahead = res.ahead
    behind = res.behind
  }

  const sc = sidecar.get(canonical)
  // Use git metadata (not `.git`-is-a-directory heuristic) so that repos
  // configured with `--separate-git-dir` are classified correctly.
  const isMain = await isMainCheckout(canonical)

  return {
    path: canonical,
    branch: raw.branch,
    head: raw.head ? raw.head.slice(0, 7) : '',
    detached: raw.detached,
    isMain,
    prunable: raw.prunable,
    createdByDplex: Boolean(sc?.createdByDplex),
    createdAt: sc?.createdAt ?? null,
    baseBranch: sc?.baseBranch ?? null,
    status: {
      ...counts,
      ahead,
      behind,
      upstream: upstream ?? null
    }
  }
}

/**
 * List all worktrees in the repo with enriched status.
 * Canonicalizes all paths. Skips bare-repo entries in v1.
 *
 * Returns `null` when git itself fails (timeout, not-a-repo, permission
 * issue). The difference matters: callers MUST NOT interpret a transient
 * failure as "no worktrees" and then reconcile away our sidecar entries.
 * Callers should retry later and keep the previous snapshot in the meantime.
 *
 * Returns `[]` only when git succeeds with no worktrees (vanishingly rare — a
 * valid repo has at least the main checkout, so the empty list effectively
 * means "bare repo" in v1 where we skip bare entries).
 */
export async function listWorktreesWithStatus(
  repoRoot: string
): Promise<WorktreeInfo[] | null> {
  const canonicalRoot = await realpath(repoRoot)
  const res = await execGitRaw(['worktree', 'list', '--porcelain'], canonicalRoot, 10_000)
  if (res.code !== 0) return null

  const identity = (await getRepoIdentity(canonicalRoot)) ?? canonicalRoot
  const raws = parsePorcelainImpl(res.stdout).filter((r) => !r.bare)
  const sidecar = getEntriesForRepo(identity)
  const enriched = await Promise.all(raws.map((r) => enrich(canonicalRoot, r, sidecar)))

  // Order: main checkout first, then by createdAt desc (if known), else by path.
  enriched.sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0
    if (ta !== tb) return tb - ta
    return a.path.localeCompare(b.path)
  })

  return enriched
}

/**
 * Run `git worktree add` with sensible defaults.
 * Returns { code, stdout, stderr } — callers map to structured errors.
 */
export async function gitWorktreeAdd(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  options: { newBranch: boolean; baseBranch: string | null }
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = ['worktree', 'add']
  if (options.newBranch) {
    args.push('-b', branch, worktreePath)
    if (options.baseBranch) args.push(options.baseBranch)
  } else {
    args.push(worktreePath, branch)
  }
  return execGitRaw(args, repoRoot, 120_000)
}

export async function gitWorktreeRemove(
  repoRoot: string,
  worktreePath: string,
  force: boolean
): Promise<{ code: number; stdout: string; stderr: string }> {
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(worktreePath)
  return execGitRaw(args, repoRoot, 30_000)
}

export async function gitBranchDelete(
  repoRoot: string,
  branch: string,
  force: boolean
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execGitRaw(['branch', force ? '-D' : '-d', branch], repoRoot, 10_000)
}

export async function gitWorktreePrune(
  repoRoot: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execGitRaw(['worktree', 'prune'], repoRoot, 10_000)
}
