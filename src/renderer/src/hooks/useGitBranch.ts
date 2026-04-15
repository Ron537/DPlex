import { useState, useEffect } from 'react'

/**
 * Reactive git branch hook.
 * Uses GitService push events instead of polling.
 */
export function useGitBranch(dirPath: string | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!dirPath) {
      setBranch(null)
      return
    }

    let cancelled = false
    let cleanupListener: (() => void) | null = null
    let watchedRepoRoot: string | null = null

    // Initial fetch
    window.dplex.git.getBranch(dirPath).then((b) => {
      if (!cancelled) setBranch(b)
    })

    // Subscribe to push updates
    window.dplex.git.watchBranch(dirPath).then((repoRoot) => {
      if (cancelled) {
        // Effect already cleaned up — tear down immediately
        if (repoRoot) window.dplex.git.unwatchBranch(repoRoot)
        return
      }
      if (!repoRoot) return
      watchedRepoRoot = repoRoot

      cleanupListener = window.dplex.git.onBranchChanged((changedRoot, newBranch) => {
        if (!cancelled && changedRoot === repoRoot) {
          setBranch(newBranch)
        }
      })
    })

    return () => {
      cancelled = true
      cleanupListener?.()
      if (watchedRepoRoot) {
        window.dplex.git.unwatchBranch(watchedRepoRoot)
      }
    }
  }, [dirPath])

  return branch
}
