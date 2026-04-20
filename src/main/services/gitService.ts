import { execFile } from 'child_process'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

interface BranchWatcher {
  watcher: fs.FSWatcher
  refCount: number
  lastBranch: string | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  callbacks: Set<(repoRoot: string, branch: string | null) => void>
}

const watchers = new Map<string, BranchWatcher>()

const DEBOUNCE_MS = 200

/**
 * Get the current git branch for a directory.
 * Resolves repo root first, so pinned subfolders work correctly.
 * Returns null if not a git repo or on error.
 */
export async function getBranch(dirPath: string): Promise<string | null> {
  try {
    const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], dirPath)
    if (!branch) return null
    // Detached HEAD returns "HEAD" — get short SHA instead
    if (branch === 'HEAD') {
      return await execGit(['rev-parse', '--short', 'HEAD'], dirPath)
    }
    return branch
  } catch {
    return null
  }
}

/**
 * Get the git repo root for a directory.
 * Returns null if not inside a git repo.
 */
export async function getRepoRoot(dirPath: string): Promise<string | null> {
  try {
    return await execGit(['rev-parse', '--show-toplevel'], dirPath)
  } catch {
    return null
  }
}

/**
 * Inspect a path and determine whether it's a git worktree of a larger repo.
 * Returns the current checkout's top-level, the main repo root (parent of
 * --git-common-dir), whether the path is a linked worktree, and the branch.
 * Returns null when the path isn't inside a git repo.
 */
export async function inspectPath(dirPath: string): Promise<{
  topLevel: string
  mainRepoPath: string
  isWorktree: boolean
  branch: string | null
} | null> {
  try {
    const topLevel = await execGit(['rev-parse', '--show-toplevel'], dirPath)
    if (!topLevel) return null
    const [gitDirRaw, commonDirRaw] = await Promise.all([
      execGit(['rev-parse', '--git-dir'], dirPath),
      execGit(['rev-parse', '--git-common-dir'], dirPath)
    ])
    if (!gitDirRaw || !commonDirRaw) return null
    // Both may be relative to CWD; resolve against the toplevel.
    const gitDir = path.isAbsolute(gitDirRaw)
      ? gitDirRaw
      : path.resolve(topLevel, gitDirRaw)
    const commonDir = path.isAbsolute(commonDirRaw)
      ? commonDirRaw
      : path.resolve(topLevel, commonDirRaw)

    // A linked worktree has a per-worktree gitdir (e.g. `.git/worktrees/foo`)
    // that differs from the shared common-dir. Comparing these two paths is
    // the only reliable way to distinguish linked worktrees from main
    // checkouts (including main checkouts using --separate-git-dir, where
    // deriving the parent from the common-dir alone is meaningless).
    const isWorktree = path.resolve(gitDir) !== path.resolve(commonDir)

    // For linked worktrees we best-effort derive the main repo's toplevel
    // from the common-dir's parent. This is correct for the standard
    // `<repo>/.git` layout and is only used as a hint (reconciliation
    // matches by path). For non-worktrees we simply return the toplevel.
    const mainRepoPath = isWorktree ? path.dirname(path.resolve(commonDir)) : path.resolve(topLevel)

    const branch = await getBranch(dirPath)
    return { topLevel, mainRepoPath, isWorktree, branch }
  } catch {
    return null
  }
}

/**
 * Start watching a directory's git branch for changes.
 * Multiple calls with paths in the same repo share one watcher (ref-counted).
 * The callback receives (canonicalRepoRoot, branch).
 */
export async function watchBranch(
  dirPath: string,
  callback: (repoRoot: string, branch: string | null) => void
): Promise<string | null> {
  const repoRoot = await getRepoRoot(dirPath)
  if (!repoRoot) return null

  const canonical = path.resolve(repoRoot)
  const existing = watchers.get(canonical)

  if (existing) {
    existing.refCount++
    existing.callbacks.add(callback)
    return canonical
  }

  const gitDir = await resolveGitDir(canonical)
  if (!gitDir) return null

  const entry: BranchWatcher = {
    watcher: null!,
    refCount: 1,
    lastBranch: await getBranch(canonical),
    debounceTimer: null,
    callbacks: new Set([callback])
  }

  try {
    entry.watcher = fs.watch(gitDir, { persistent: false }, (_eventType, filename) => {
      // Only care about HEAD changes (branch checkout, merge, rebase)
      if (!filename || !isRelevantGitFile(filename)) return

      if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
      entry.debounceTimer = setTimeout(async () => {
        entry.debounceTimer = null
        const branch = await getBranch(canonical)
        if (branch !== entry.lastBranch) {
          entry.lastBranch = branch
          for (const cb of entry.callbacks) {
            cb(canonical, branch)
          }
        }
      }, DEBOUNCE_MS)
    })

    entry.watcher.on('error', () => {
      // Watcher failed — clean up silently
      cleanupWatcher(canonical)
    })
  } catch {
    return null
  }

  watchers.set(canonical, entry)
  return canonical
}

/**
 * Stop watching a directory's git branch.
 * Decrements ref count; only closes the watcher when no refs remain.
 */
export function unwatchBranch(
  repoRoot: string,
  callback: (repoRoot: string, branch: string | null) => void
): void {
  const canonical = path.resolve(repoRoot)
  const entry = watchers.get(canonical)
  if (!entry) return

  entry.callbacks.delete(callback)
  entry.refCount--

  if (entry.refCount <= 0) {
    cleanupWatcher(canonical)
  }
}

/** Stop all branch watchers. Call on app shutdown. */
export function stopAllBranchWatchers(): void {
  for (const [key] of watchers) {
    cleanupWatcher(key)
  }
}

// ── Private helpers ────────────────────────────────────────────────

function cleanupWatcher(canonical: string): void {
  const entry = watchers.get(canonical)
  if (!entry) return

  if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
  try {
    entry.watcher.close()
  } catch {
    // Already closed
  }
  entry.callbacks.clear()
  watchers.delete(canonical)
}

/**
 * Resolve the actual .git directory path.
 * Handles worktrees where .git is a file containing "gitdir: <path>".
 */
export async function resolveGitDir(repoRoot: string): Promise<string | null> {
  const gitPath = path.join(repoRoot, '.git')

  try {
    const stat = await fsp.stat(gitPath)
    if (stat.isDirectory()) return gitPath

    // Worktree: .git is a file with "gitdir: <path>"
    if (stat.isFile()) {
      const content = (await fsp.readFile(gitPath, 'utf-8')).trim()
      const match = content.match(/^gitdir:\s*(.+)$/)
      if (!match) return null
      const gitdir = match[1]
      // Support relative paths
      const resolved = path.isAbsolute(gitdir) ? gitdir : path.resolve(repoRoot, gitdir)
      try {
        await fsp.access(resolved)
        return resolved
      } catch {
        return null
      }
    }
  } catch {
    // .git doesn't exist
  }

  return null
}

function isRelevantGitFile(filename: string): boolean {
  // Normalize path separators for cross-platform
  const normalized = filename.replace(/\\/g, '/')
  return (
    normalized === 'HEAD' ||
    normalized.startsWith('refs/heads/') ||
    normalized === 'MERGE_HEAD' ||
    normalized === 'REBASE_HEAD'
  )
}

function execGit(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null)
      const result = stdout.trim()
      resolve(result || null)
    })
  })
}

/**
 * Run a git command and return full result (stdout+stderr+exit code) for callers
 * that need to distinguish success-empty-output from failure.
 */
export function execGitRaw(
  args: string[],
  cwd: string,
  timeoutMs = 10_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const maybeCode = (err as NodeJS.ErrnoException & { code?: number | string }).code
          const code = typeof maybeCode === 'number' ? maybeCode : 1
          resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message ?? '') })
          return
        }
        resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    )
  })
}

/**
 * Canonicalize a filesystem path — resolves symlinks and normalizes separators.
 * Falls back to path.resolve if the path does not exist yet.
 */
export async function realpath(p: string): Promise<string> {
  try {
    return await fsp.realpath(p)
  } catch {
    return path.resolve(p)
  }
}

export function realpathSync(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * List local branches (short names, no "refs/heads/" prefix).
 */
export async function listLocalBranches(repoRoot: string): Promise<string[]> {
  const result = await execGitRaw(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
    repoRoot
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * List remote-tracking branches as "origin/feat" style names, excluding HEAD aliases.
 */
export async function listRemoteBranches(repoRoot: string): Promise<string[]> {
  const result = await execGitRaw(
    ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'],
    repoRoot
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.endsWith('/HEAD'))
}

/**
 * Resolve the default base branch for new worktrees.
 * Priority: origin/HEAD symref → main → master → null.
 */
export async function resolveDefaultBaseBranch(repoRoot: string): Promise<string | null> {
  // Try origin/HEAD first — this is what `git symbolic-ref` returns for the default branch.
  const headRef = await execGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repoRoot)
  if (headRef) {
    // Strip "origin/" prefix if present
    return headRef.startsWith('origin/') ? headRef.slice('origin/'.length) : headRef
  }

  // Fall back to conventional branch names if they exist locally.
  const locals = await listLocalBranches(repoRoot)
  if (locals.includes('main')) return 'main'
  if (locals.includes('master')) return 'master'
  return locals[0] ?? null
}

/**
 * Count commits in `head` that are not in `base` (i.e. how many commits ahead `head` is).
 * Returns null on error.
 */
export async function revListCount(
  repoRoot: string,
  base: string,
  head: string
): Promise<number | null> {
  const result = await execGitRaw(
    ['rev-list', '--count', `${base}..${head}`],
    repoRoot
  )
  if (result.code !== 0) return null
  const n = parseInt(result.stdout.trim(), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Return both "ahead of base" and "behind base" commit counts for a branch/ref.
 * Returns null for fields that could not be computed.
 */
export async function revListAheadBehind(
  repoRoot: string,
  base: string,
  head: string
): Promise<{ ahead: number | null; behind: number | null }> {
  const result = await execGitRaw(
    ['rev-list', '--left-right', '--count', `${base}...${head}`],
    repoRoot
  )
  if (result.code !== 0) return { ahead: null, behind: null }
  // Output format: "<behind>\t<ahead>" — left side is `base`, right side is `head`.
  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length < 2) return { ahead: null, behind: null }
  const behind = parseInt(parts[0], 10)
  const ahead = parseInt(parts[1], 10)
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  }
}

/**
 * Return the upstream tracking ref for a branch (e.g. "origin/feature/auth"),
 * or null if the branch has no upstream set.
 */
export async function getUpstream(
  repoRoot: string,
  branch: string
): Promise<string | null> {
  const result = await execGitRaw(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`],
    repoRoot
  )
  if (result.code !== 0) return null
  const out = result.stdout.trim()
  return out.length > 0 ? out : null
}

/**
 * Return the common git dir (the .git directory shared by all worktrees of a repo).
 * For a main checkout this is `<repo>/.git`. For a worktree it's `<main>/.git`.
 * Returns null if not a git repo.
 */
export async function getCommonGitDir(repoRoot: string): Promise<string | null> {
  const result = await execGitRaw(['rev-parse', '--git-common-dir'], repoRoot)
  if (result.code !== 0) return null
  const out = result.stdout.trim()
  if (!out) return null
  return path.isAbsolute(out) ? out : path.resolve(repoRoot, out)
}

/**
 * True if the given path is the main checkout of its repo (i.e. not a linked worktree).
 */
export async function isMainCheckout(repoRoot: string): Promise<boolean> {
  const canonical = await realpath(repoRoot)
  const result = await execGitRaw(['rev-parse', '--git-dir'], canonical)
  if (result.code !== 0) return false
  const gitDir = result.stdout.trim()
  if (!gitDir) return false
  // Linked worktrees have `--git-dir` pointing at `<common>/worktrees/<name>`.
  // Main checkouts have `--git-dir` equal to their common dir.
  const abs = path.isAbsolute(gitDir) ? gitDir : path.resolve(canonical, gitDir)
  const common = await getCommonGitDir(canonical)
  if (!common) return false
  return (await realpath(abs)) === (await realpath(common))
}

/**
 * Canonical repo identity — stable across main checkout and linked worktrees.
 *
 * Strategy:
 *   1. Resolve the shared `--git-common-dir` (stable per repo; the same for
 *      main + every linked worktree).
 *   2. If that common dir is a `.git` directory inside a working tree (the
 *      standard layout), return its parent — i.e. the main checkout root.
 *      This is the most useful identity because git commands can be run
 *      against it.
 *   3. Otherwise (submodules, `--separate-git-dir`, bare repos, etc.) fall
 *      back to the realpathed common dir itself. It's a stable string that
 *      is identical for every worktree of the same repo, which is all we
 *      actually need for keying sidecar/watchers/queues.
 *
 * Returns null when the path is not inside a git repo.
 */
export async function getRepoIdentity(repoRoot: string): Promise<string | null> {
  const commonDir = await getCommonGitDir(repoRoot)
  if (!commonDir) return null
  const realCommon = await realpath(commonDir)
  // Standard layout: `<main>/.git`. Use parent as the identity.
  if (path.basename(realCommon) === '.git') {
    const parent = path.dirname(realCommon)
    // Verify the parent is actually a working tree. For submodules the
    // common dir lives under `<super>/.git/modules/<name>` whose basename
    // is `<name>`, not `.git`, so this branch won't run — the fallback does.
    try {
      await fsp.access(parent)
      return await realpath(parent)
    } catch {
      /* fall through */
    }
  }
  // Non-standard layout — return the common dir itself as the stable key.
  return realCommon
}
