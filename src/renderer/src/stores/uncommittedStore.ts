import { create } from 'zustand'
import { useProjectStore } from './projectStore'
import { normalizePath } from '../utils/normalizePath'

/** One repo's working-tree change count. */
export interface UncommittedRepo {
  root: string
  label: string
  count: number
}

interface UncommittedState {
  /** Total uncommitted files across all registered repos. */
  total: number
  /** Number of repos with at least one uncommitted change. */
  repoCount: number
  /** Per-repo breakdown (count > 0 only), most-changed first. */
  repos: UncommittedRepo[]
  loading: boolean
  /**
   * Query the working-tree change count for every registered project. Reuses
   * the existing `diff.listChanges` IPC; runs on demand (dashboard open /
   * manual refresh), concurrency-capped — no polling.
   */
  refresh: () => Promise<void>
}

function folderName(p: string): string {
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

/** Run `tasks` with a bounded number of concurrent workers. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

export const useUncommittedStore = create<UncommittedState>((set, get) => ({
  total: 0,
  repoCount: 0,
  repos: [],
  loading: false,

  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    // Each project (and worktree) is a distinct checkout — dedupe only by the
    // normalized path so two projects on the exact same folder count once.
    const projects = useProjectStore.getState().projects
    const seen = new Set<string>()
    const targets: { root: string; label: string }[] = []
    for (const p of projects) {
      const key = normalizePath(p.path)
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ root: p.path, label: p.name || folderName(p.path) })
    }

    const repos: UncommittedRepo[] = []
    await pooled(targets, 4, async ({ root, label }) => {
      try {
        const res = await window.dplex.diff.listChanges(root, { kind: 'workingTree' })
        const count = res.totalCount ?? res.files.length
        if (count > 0) repos.push({ root, label, count })
      } catch {
        // Non-git folder or transient error — treat as no changes.
      }
    })

    repos.sort((a, b) => b.count - a.count)
    set({
      repos,
      repoCount: repos.length,
      total: repos.reduce((sum, r) => sum + r.count, 0),
      loading: false
    })
  }
}))
