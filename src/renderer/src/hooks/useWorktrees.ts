import { useEffect, useState } from 'react'
import { useWorktreeStore } from '../stores/worktreeStore'
import type { WorktreeInfo } from '../../../preload'

// Module-level ref counting so multiple components can subscribe to the same
// repo without tearing each other's watchers down.
interface RefCountEntry {
  count: number
  // Pending/resolved subscription. Concurrent callers await this same promise
  // so StrictMode double-invoke doesn't abort the second mount before the
  // first watchRepo has resolved.
  promise: Promise<{ token: string; repoRoot: string } | null>
}
const refCounts = new Map<string, RefCountEntry>()

export function ensureWorktreeSubscription(
  repoPath: string
): Promise<{ token: string; repoRoot: string } | null> {
  return ensureSubscription(repoPath)
}

export function releaseWorktreeSubscription(repoPath: string): void {
  releaseSubscription(repoPath)
}

function ensureSubscription(
  repoPath: string
): Promise<{ token: string; repoRoot: string } | null> {
  const existing = refCounts.get(repoPath)
  if (existing) {
    existing.count += 1
    return existing.promise
  }
  const promise = (async () => {
    const result = await window.dplex.worktrees.watchRepo(repoPath)
    if (!result) {
      // Subscription failed — remove entry so a later attempt can retry.
      refCounts.delete(repoPath)
      return null
    }
    return { token: result.token, repoRoot: result.repoRoot }
  })()
  refCounts.set(repoPath, { count: 1, promise })
  return promise
}

function releaseSubscription(repoPath: string): void {
  const existing = refCounts.get(repoPath)
  if (!existing) return
  existing.count -= 1
  if (existing.count <= 0) {
    // Wait for the subscription to resolve before unwatching — otherwise we
    // might try to unwatch a token we haven't received yet.
    const pending = existing.promise
    refCounts.delete(repoPath)
    void pending.then((sub) => {
      if (sub) window.dplex.worktrees.unwatchRepo(sub.token)
    })
  }
}

/**
 * Subscribe to worktree updates for a given project path. Automatically
 * resolves the repo root on the main side, manages watcher subscription,
 * and returns the current snapshot + helpers.
 */
export function useWorktrees(projectPath: string | undefined): {
  worktrees: WorktreeInfo[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  isGitRepo: boolean
  repoRoot: string | null
} {
  const [isGitRepo, setIsGitRepo] = useState<boolean>(false)
  const setLoading = useWorktreeStore((s) => s.setLoading)

  const [canonicalRoot, setCanonicalRoot] = useState<string | null>(null)

  // Subscribe only to this repo's slice so unrelated repo updates don't
  // re-render this component.
  const repo = useWorktreeStore((s) => (canonicalRoot ? s.repos.get(canonicalRoot) : undefined))

  useEffect(() => {
    // Reset immediately on projectPath change so callers don't briefly see
    // the previous repo's state while the new subscription resolves.
    setIsGitRepo(false)
    setCanonicalRoot(null)

    if (!projectPath) return

    let cancelled = false
    let acquired = false

    const run = async (): Promise<void> => {
      try {
        const sub = await ensureSubscription(projectPath)
        if (cancelled) {
          if (sub) releaseSubscription(projectPath)
          return
        }
        if (!sub) {
          setIsGitRepo(false)
          return
        }
        acquired = true
        setIsGitRepo(true)
        setCanonicalRoot(sub.repoRoot)
        setLoading(sub.repoRoot, false)
      } catch {
        // Pre-resolve errors (e.g. git binary missing) are rare and
        // recoverable via the next projectPath change; there is no
        // canonical root yet to key into the store's error slice.
      }
    }

    void run()

    return () => {
      cancelled = true
      if (acquired) releaseSubscription(projectPath)
    }
  }, [projectPath, setLoading])

  return {
    worktrees: repo?.worktrees ?? [],
    loading: repo?.loading ?? false,
    error: repo?.error ?? null,
    isGitRepo,
    repoRoot: canonicalRoot,
    refresh: async () => {
      if (canonicalRoot) {
        await window.dplex.worktrees.refresh(canonicalRoot)
      } else if (projectPath) {
        await window.dplex.worktrees.refresh(projectPath)
      }
    }
  }
}
