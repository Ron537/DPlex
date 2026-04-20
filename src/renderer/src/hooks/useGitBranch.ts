import { useState, useEffect } from 'react'

/**
 * Reactive git branch hook.
 * Uses GitService push events instead of polling.
 */
export function useGitBranch(dirPath: string | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    // Clear any prior value immediately so the UI doesn't show a stale
    // branch during the async switch to a new path.
    setBranch(null)

    if (!dirPath) return

    let cancelled = false
    let cleanupListener: (() => void) | null = null
    let watchToken: string | null = null

    // Initial fetch
    window.dplex.git.getBranch(dirPath).then((b) => {
      if (!cancelled) setBranch(b)
    })

    // Subscribe to push updates
    window.dplex.git.watchBranch(dirPath).then((result) => {
      if (cancelled) {
        // Effect already cleaned up — tear down immediately
        if (result) window.dplex.git.unwatchBranch(result.token)
        return
      }
      if (!result) return
      watchToken = result.token

      cleanupListener = window.dplex.git.onBranchChanged((changedRoot, newBranch) => {
        if (!cancelled && changedRoot === result.repoRoot) {
          setBranch(newBranch)
        }
      })
    })

    return () => {
      cancelled = true
      cleanupListener?.()
      if (watchToken) {
        window.dplex.git.unwatchBranch(watchToken)
      }
    }
  }, [dirPath])

  return branch
}
