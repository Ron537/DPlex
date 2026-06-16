import { create } from 'zustand'
import type { ChangedFile, CommitGraphEntry } from '../../../preload'
import { useProjectStore } from './projectStore'
import { useSettingsStore } from './settingsStore'
import type { Project } from '../types'

/** Commits fetched per page. */
const PAGE_SIZE = 100
/** Debounce for repo-event-driven graph refreshes. */
const REFRESH_DEBOUNCE_MS = 700

interface CommitFilesEntry {
  files: ChangedFile[]
  loading: boolean
  /** True once a fetch has successfully completed (even with zero files). */
  loaded: boolean
  error: string | null
}

interface GraphRepoEntry {
  commits: CommitGraphEntry[]
  hasMore: boolean
  /** First-page load in flight. */
  loading: boolean
  /** A "load more" page is in flight. */
  loadingMore: boolean
  error: string | null
  /** Monotonic request generation — drops stale responses. */
  generation: number
  /** SHAs whose file list is expanded in the UI. */
  expanded: string[]
  /** Lazily-loaded changed-files per commit SHA. */
  files: Record<string, CommitFilesEntry>
}

interface GitGraphState {
  /** Cache keyed by canonical repoRootFs (same key space as gitPanelStore). */
  byRepo: Record<string, GraphRepoEntry>

  /** Resolve the active worktree root for a project. */
  resolveActiveRoot: (project: Project) => string

  /** Load (or refresh) the first page for a repo. No-ops if fresh unless forced. */
  load: (repoRootFs: string, opts?: { force?: boolean }) => void
  /** Append the next page of commits. */
  loadMore: (repoRootFs: string) => void
  /** Toggle a commit's expanded file list, lazily fetching files on expand. */
  toggleExpand: (repoRootFs: string, sha: string) => void
  /** Fetch a commit's changed files into the cache (idempotent). */
  loadCommitFiles: (repoRootFs: string, sha: string) => void
  /** Force a refresh of the first page (manual refresh button). */
  refresh: (repoRootFs: string) => void

  /** Test/teardown helper. */
  reset: () => void
}

function repoEntryDefault(): GraphRepoEntry {
  return {
    commits: [],
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
    generation: 0,
    expanded: [],
    files: {}
  }
}

export const useGitGraphStore = create<GitGraphState>((set, get) => ({
  byRepo: {},

  resolveActiveRoot: (project) => project.path,

  load: (repoRootFs, opts) => {
    const force = opts?.force === true
    const existing = get().byRepo[repoRootFs]
    if (existing && existing.loading) return
    if (existing && !force && existing.commits.length > 0) return

    const generation = (existing?.generation ?? 0) + 1
    set((s) => ({
      byRepo: {
        ...s.byRepo,
        [repoRootFs]: {
          ...(existing ?? repoEntryDefault()),
          loading: true,
          // Bumping the generation supersedes any in-flight `loadMore`, whose
          // stale response is dropped without clearing this flag — so reset it
          // here to avoid permanently disabling the "Load more" button.
          loadingMore: false,
          error: null,
          generation
        }
      }
    }))

    void window.dplex.diff
      .getCommitGraph(repoRootFs, { limit: PAGE_SIZE, skip: 0 })
      .then((res) => {
        const cur = get().byRepo[repoRootFs]
        if (!cur || cur.generation !== generation) return
        // Dedupe: if the head commit is unchanged, the entire reachable history
        // is identical (same head SHA ⇒ same DAG), so leave the existing list
        // untouched — including any pages loaded via "Load more" — and just
        // clear the loading flags. This makes the frequent event-driven
        // revalidations cheap (one `git log` then bail).
        const sameHead =
          cur.commits.length > 0 &&
          res.commits.length > 0 &&
          cur.commits[0].sha === res.commits[0].sha
        if (sameHead) {
          set((s) => ({
            byRepo: { ...s.byRepo, [repoRootFs]: { ...cur, loading: false } }
          }))
          return
        }
        // Keep expansion for commits still present; refetch their files.
        const stillPresent = new Set(res.commits.map((c) => c.sha))
        const expanded = cur.expanded.filter((sha) => stillPresent.has(sha))
        set((s) => ({
          byRepo: {
            ...s.byRepo,
            [repoRootFs]: {
              ...cur,
              commits: res.commits,
              hasMore: res.hasMore,
              loading: false,
              error: null,
              expanded,
              files: {} // invalidate — commit set changed
            }
          }
        }))
        // Refetch files for commits that remain expanded after the refresh.
        for (const sha of expanded) get().loadCommitFiles(repoRootFs, sha)
      })
      .catch((e: unknown) => {
        const cur = get().byRepo[repoRootFs]
        if (!cur || cur.generation !== generation) return
        set((s) => ({
          byRepo: {
            ...s.byRepo,
            [repoRootFs]: {
              ...cur,
              loading: false,
              error: e instanceof Error ? e.message : String(e)
            }
          }
        }))
      })
  },

  loadMore: (repoRootFs) => {
    const cur = get().byRepo[repoRootFs]
    if (!cur || cur.loading || cur.loadingMore || !cur.hasMore) return
    const generation = cur.generation
    const skip = cur.commits.length
    set((s) => ({
      byRepo: { ...s.byRepo, [repoRootFs]: { ...cur, loadingMore: true } }
    }))
    void window.dplex.diff
      .getCommitGraph(repoRootFs, { limit: PAGE_SIZE, skip })
      .then((res) => {
        const c = get().byRepo[repoRootFs]
        if (!c || c.generation !== generation) return
        // Guard against duplicates if the head shifted between requests.
        const seen = new Set(c.commits.map((x) => x.sha))
        const appended = res.commits.filter((x) => !seen.has(x.sha))
        set((s) => ({
          byRepo: {
            ...s.byRepo,
            [repoRootFs]: {
              ...c,
              commits: [...c.commits, ...appended],
              hasMore: res.hasMore,
              loadingMore: false
            }
          }
        }))
      })
      .catch(() => {
        const c = get().byRepo[repoRootFs]
        if (!c || c.generation !== generation) return
        set((s) => ({
          byRepo: { ...s.byRepo, [repoRootFs]: { ...c, loadingMore: false } }
        }))
      })
  },

  toggleExpand: (repoRootFs, sha) => {
    const cur = get().byRepo[repoRootFs]
    if (!cur) return
    const isExpanded = cur.expanded.includes(sha)
    const expanded = isExpanded ? cur.expanded.filter((s) => s !== sha) : [...cur.expanded, sha]
    set((s) => ({
      byRepo: { ...s.byRepo, [repoRootFs]: { ...cur, expanded } }
    }))
    if (!isExpanded) get().loadCommitFiles(repoRootFs, sha)
  },

  loadCommitFiles: (repoRootFs, sha) => {
    const cur = get().byRepo[repoRootFs]
    if (!cur) return
    // Skip if a fetch is in flight or already completed. A prior error does
    // NOT block a retry — re-expanding the row re-issues the request.
    const cached = cur.files[sha]
    if (cached && (cached.loading || cached.loaded)) return
    set((s) => {
      const e = s.byRepo[repoRootFs]
      if (!e) return s
      return {
        byRepo: {
          ...s.byRepo,
          [repoRootFs]: {
            ...e,
            files: { ...e.files, [sha]: { files: [], loading: true, loaded: false, error: null } }
          }
        }
      }
    })
    void window.dplex.diff
      .getCommitFiles(repoRootFs, sha)
      .then((res) => {
        const e = get().byRepo[repoRootFs]
        if (!e) return
        set((s) => ({
          byRepo: {
            ...s.byRepo,
            [repoRootFs]: {
              ...e,
              files: {
                ...e.files,
                [sha]: { files: res.files, loading: false, loaded: true, error: null }
              }
            }
          }
        }))
      })
      .catch((err: unknown) => {
        const e = get().byRepo[repoRootFs]
        if (!e) return
        set((s) => ({
          byRepo: {
            ...s.byRepo,
            [repoRootFs]: {
              ...e,
              files: {
                ...e.files,
                [sha]: {
                  files: [],
                  loading: false,
                  loaded: false,
                  error: err instanceof Error ? err.message : String(err)
                }
              }
            }
          }
        }))
      })
  },

  refresh: (repoRootFs) => get().load(repoRootFs, { force: true }),

  reset: () => set({ byRepo: {} })
}))

/**
 * Wires global graph refresh side-effects exactly once:
 *  - Refreshes the active repo's graph when HEAD/refs move (branch change).
 *  - Refreshes (debounced, deduped) when the working tree changes — this
 *    catches new commits on the current branch, which don't change the
 *    branch *name* and so don't fire `onBranchChanged`.
 *
 * Graph fetches only run while the Graph section is expanded, to avoid
 * spending `git log` on a hidden panel.
 */
let wired = false
export function wireGitGraphGlobals(): () => void {
  if (wired) return () => undefined
  wired = true

  const graphSectionOpen = (): boolean => {
    const s = useSettingsStore.getState().settings
    return (
      s.sidebarActiveTab === 'git' &&
      !s.sidebarPanelCollapsed &&
      s.gitPanel.sectionCollapse.graph === false
    )
  }

  const activeRoot = (): string | null => {
    const ps = useProjectStore.getState()
    const proj = ps.projects.find((p) => p.id === ps.activeProjectId) ?? null
    return proj ? useGitGraphStore.getState().resolveActiveRoot(proj) : null
  }

  const offBranch = window.dplex.git.onBranchChanged((repoRoot) => {
    if (!graphSectionOpen()) return
    const root = activeRoot()
    if (root && root === repoRoot) useGitGraphStore.getState().refresh(root)
  })

  let timer: number | undefined
  const offChanges = window.dplex.diff.onChangesChanged((p) => {
    if (!graphSectionOpen()) return
    const root = activeRoot()
    if (!root || root !== p.repoRootFs) return
    // Only meaningful if we already have a graph loaded; the head-SHA
    // dedupe in load() makes a no-op cheap when no new commit landed.
    if (!useGitGraphStore.getState().byRepo[root]) return
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      // `force: true` bypasses the cache-only early-return so we actually
      // re-run `git log`; the head-SHA dedupe then preserves loaded pages
      // when nothing changed and replaces them when a new commit landed.
      useGitGraphStore.getState().load(root, { force: true })
    }, REFRESH_DEBOUNCE_MS)
  })

  return () => {
    offBranch()
    offChanges()
    if (timer !== undefined) window.clearTimeout(timer)
    wired = false
  }
}
