import { create } from 'zustand'
import type { WorktreeInfo } from '../../../preload'

interface RepoState {
  worktrees: WorktreeInfo[]
  loading: boolean
  error: string | null
  lastFetchedAt: number
}

interface WorktreeStoreState {
  repos: Map<string, RepoState>
  applySnapshot: (repoRoot: string, worktrees: WorktreeInfo[]) => void
  setLoading: (repoRoot: string, loading: boolean) => void
  setError: (repoRoot: string, error: string | null) => void
  getRepo: (repoRoot: string) => RepoState | undefined
  clear: (repoRoot: string) => void
}

function worktreesEqual(a: WorktreeInfo[], b: WorktreeInfo[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.path !== y.path ||
      x.branch !== y.branch ||
      x.head !== y.head ||
      x.detached !== y.detached ||
      x.isMain !== y.isMain ||
      x.prunable !== y.prunable ||
      x.createdByDplex !== y.createdByDplex ||
      x.createdAt !== y.createdAt ||
      x.baseBranch !== y.baseBranch ||
      x.status.dirtyCount !== y.status.dirtyCount ||
      x.status.untrackedCount !== y.status.untrackedCount ||
      x.status.stagedCount !== y.status.stagedCount ||
      x.status.ahead !== y.status.ahead ||
      x.status.behind !== y.status.behind ||
      x.status.upstream !== y.status.upstream
    ) {
      return false
    }
  }
  return true
}

export const useWorktreeStore = create<WorktreeStoreState>((set, get) => ({
  repos: new Map(),

  applySnapshot: (repoRoot, worktrees) => {
    const prev = get().repos.get(repoRoot)
    // Skip work entirely when the snapshot is structurally unchanged AND
    // the loading/error flags are already cleared. This prevents a
    // re-render storm when the main process emits duplicate payloads.
    if (
      prev &&
      !prev.loading &&
      prev.error === null &&
      worktreesEqual(prev.worktrees, worktrees)
    ) {
      return
    }
    const repos = new Map(get().repos)
    repos.set(repoRoot, {
      worktrees,
      loading: false,
      error: null,
      lastFetchedAt: Date.now()
    })
    set({ repos })
  },

  setLoading: (repoRoot, loading) => {
    const prev = get().repos.get(repoRoot) ?? {
      worktrees: [],
      loading: false,
      error: null,
      lastFetchedAt: 0
    }
    if (prev.loading === loading) return
    const repos = new Map(get().repos)
    repos.set(repoRoot, { ...prev, loading })
    set({ repos })
  },

  setError: (repoRoot, error) => {
    const prev = get().repos.get(repoRoot) ?? {
      worktrees: [],
      loading: false,
      error: null,
      lastFetchedAt: 0
    }
    if (prev.error === error && prev.loading === false) return
    const repos = new Map(get().repos)
    repos.set(repoRoot, { ...prev, error, loading: false })
    set({ repos })
  },

  getRepo: (repoRoot) => get().repos.get(repoRoot),

  clear: (repoRoot) => {
    if (!get().repos.has(repoRoot)) return
    const repos = new Map(get().repos)
    repos.delete(repoRoot)
    set({ repos })
  }
}))

// Install a single module-level `onChanged` listener so that every repo
// subscribed on the main side flows into the store without each hook instance
// registering its own listener (which caused O(N²) fan-out on the hot path).
//
// Guard against Vite HMR re-evaluating this module, which would otherwise
// stack a new listener on every hot-reload during development.
declare global {
  interface Window {
    __dplexWorktreeListenerInstalled?: boolean
  }
}

if (
  typeof window !== 'undefined' &&
  window.dplex?.worktrees?.onChanged &&
  !window.__dplexWorktreeListenerInstalled
) {
  window.__dplexWorktreeListenerInstalled = true
  window.dplex.worktrees.onChanged((payload) => {
    useWorktreeStore.getState().applySnapshot(payload.repoRoot, payload.worktrees)
  })
}
