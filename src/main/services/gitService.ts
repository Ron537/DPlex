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
async function resolveGitDir(repoRoot: string): Promise<string | null> {
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
