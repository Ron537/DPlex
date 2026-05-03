import { create } from 'zustand'
import type { ChangedFile, ChangeListResult, DiffScope, RepoStatus } from '../../../preload/index'
import { useSettingsStore } from './settingsStore'
import { useProjectStore } from './projectStore'
import { useTerminalStore } from './terminalStore'
import type { Project } from '../types'

const TEARDOWN_GRACE_MS = 5_000

/** Monotonic counter for watcher lifecycle generations — used to detect
 *  release/acquire races so a stale subscribe-response or grace-teardown
 *  timer doesn't clobber a freshly re-acquired watcher. */
let nextWatcherGen = 0

interface RepoEntry {
  files: ChangedFile[]
  status: RepoStatus | null
  lastLoadedAt: number
  generation: number
  /** Last error from listChanges or getRepoStatus, if any. */
  error: string | null
}

interface LiveWatcher {
  token: string
  refCount: number
  generation: number
  teardownTimer: ReturnType<typeof setTimeout> | null
}

interface GitPanelState {
  /** Cache keyed by canonical repoRootFs. Two projects on the same repo
   *  share an entry. */
  byRepo: Record<string, RepoEntry>
  /** Live diff watchers keyed by repoRootFs. Refcounted across consumers
   *  (Git panel, status bar). Released with grace so collapse → expand
   *  doesn't tear down and re-subscribe. */
  liveWatchers: Record<string, LiveWatcher>
  /** Per-repo loading flag, used by the panel to render a spinner. */
  loading: Record<string, boolean>

  // Settings-derived (proxied via settingsStore for persistence)
  isOpen: () => boolean
  expand: () => void
  collapse: () => void
  toggle: () => void
  setWidth: (width: number) => void

  /** Resolve the active worktree root for a project, validated against the
   *  project list (only registered worktrees are allowed). Falls back to
   *  the project root if the persisted root is no longer registered. */
  resolveActiveRoot: (project: Project) => string

  /** Bind to a project: ensures a watcher for its active worktree, fetches
   *  the changes list, and (if not already cached) the repo status. Safe to
   *  call repeatedly — coalesces against the live request generation. */
  bindToProject: (projectId: string, opts?: { force?: boolean }) => void
  /** Manually-triggered refresh — same as bindToProject({force: true}). */
  refresh: (projectId: string) => void

  /** Acquire/release watcher for a repo. Refcounted with grace teardown. */
  acquireWatcher: (repoRootFs: string) => void
  releaseWatcher: (repoRootFs: string) => void

  /** Open a file diff tab — preview by default, permanent on double-click. */
  openFile: (project: Project, file: ChangedFile, opts?: { promote?: boolean }) => void

  /** Test/teardown helper: drop all watchers and clear caches. */
  reset: () => void
}

function repoEntryDefault(): RepoEntry {
  return {
    files: [],
    status: null,
    lastLoadedAt: 0,
    generation: 0,
    error: null
  }
}

export const useGitPanelStore = create<GitPanelState>((set, get) => ({
  byRepo: {},
  liveWatchers: {},
  loading: {},

  isOpen: () => useSettingsStore.getState().settings.gitPanel.open,
  expand: () => {
    useSettingsStore.getState().updateSettings({
      gitPanel: { ...useSettingsStore.getState().settings.gitPanel, open: true }
    })
  },
  collapse: () => {
    useSettingsStore.getState().updateSettings({
      gitPanel: { ...useSettingsStore.getState().settings.gitPanel, open: false }
    })
  },
  toggle: () => {
    const cur = useSettingsStore.getState().settings.gitPanel
    useSettingsStore.getState().updateSettings({
      gitPanel: { ...cur, open: !cur.open }
    })
  },
  setWidth: (width) => {
    const cur = useSettingsStore.getState().settings.gitPanel
    useSettingsStore.getState().updateSettings({
      gitPanel: { ...cur, width: Math.max(220, Math.min(640, Math.round(width))) }
    })
  },

  resolveActiveRoot: (project) => project.path,

  bindToProject: (projectId, opts) => {
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
    if (!project) return
    const root = get().resolveActiveRoot(project)
    // NOTE: bindToProject is purely a fetch trigger. Watcher lifecycle is
    // owned exclusively by `wireGitPanelGlobals` (active-project subscription)
    // so refresh paths and re-mounts can't leak refcounts.
    const force = opts?.force === true
    const existing = get().byRepo[root]
    const stale = !existing || force || Date.now() - existing.lastLoadedAt > 30_000
    if (!stale) return

    // Bump generation BEFORE issuing requests so any in-flight earlier
    // responses are dropped on arrival.
    const generation = (existing?.generation ?? 0) + 1
    set((s) => ({
      byRepo: {
        ...s.byRepo,
        [root]: {
          ...(existing ?? repoEntryDefault()),
          generation
        }
      },
      loading: { ...s.loading, [root]: true }
    }))

    const scope: DiffScope = { kind: 'workingTree' }

    void Promise.all([
      window.dplex.diff
        .listChanges(root, scope)
        .then((r): { ok: true; data: ChangeListResult } => ({ ok: true, data: r }))
        .catch((e: unknown): { ok: false; error: string } => ({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        })),
      window.dplex.diff
        .getRepoStatus(root)
        .then((r): { ok: true; data: RepoStatus } => ({ ok: true, data: r }))
        .catch((e: unknown): { ok: false; error: string } => ({
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }))
    ]).then(([changesRes, statusRes]) => {
      const cur = get().byRepo[root]
      // Drop stale responses — a newer request has been issued.
      if (!cur || cur.generation !== generation) return
      const files = changesRes.ok ? changesRes.data.files : []
      const status = statusRes.ok ? statusRes.data : null
      const error = !changesRes.ok ? changesRes.error : !statusRes.ok ? statusRes.error : null
      set((s) => ({
        byRepo: {
          ...s.byRepo,
          [root]: {
            files,
            status,
            generation,
            lastLoadedAt: Date.now(),
            error
          }
        },
        loading: { ...s.loading, [root]: false }
      }))

      // Validate persisted selection — drop if file no longer present.
      const sel = project.gitPanelState?.selectedGitPath
      if (sel && !files.some((f) => f.gitPath === sel)) {
        useProjectStore.getState().setProjectGitState(project.id, { selectedGitPath: undefined })
      }
    })
  },

  refresh: (projectId) => get().bindToProject(projectId, { force: true }),

  acquireWatcher: (repoRootFs) => {
    const cur = get().liveWatchers[repoRootFs]
    if (cur) {
      // Cancel pending teardown if any.
      if (cur.teardownTimer) {
        clearTimeout(cur.teardownTimer)
      }
      set((s) => ({
        liveWatchers: {
          ...s.liveWatchers,
          [repoRootFs]: {
            ...cur,
            refCount: cur.refCount + 1,
            teardownTimer: null
          }
        }
      }))
      return
    }

    // Optimistically reserve the slot so concurrent acquires don't double-
    // subscribe; capture a generation so we can ignore the late
    // subscribe response if a release-then-acquire raced past us.
    const generation = ++nextWatcherGen
    set((s) => ({
      liveWatchers: {
        ...s.liveWatchers,
        [repoRootFs]: {
          token: '',
          refCount: 1,
          generation,
          teardownTimer: null
        }
      }
    }))

    void window.dplex.diff
      .subscribe(repoRootFs)
      .then((res) => {
        const token = res?.token ?? ''
        const live = get().liveWatchers[repoRootFs]
        // Drop response if our slot was replaced by a newer acquire/release.
        if (!live || live.generation !== generation) {
          if (token) window.dplex.diff.unsubscribe(token)
          return
        }
        if (!token) {
          set((s) => {
            const next = { ...s.liveWatchers }
            delete next[repoRootFs]
            return { liveWatchers: next }
          })
          return
        }
        set((s) => ({
          liveWatchers: {
            ...s.liveWatchers,
            [repoRootFs]: { ...live, token }
          }
        }))
      })
      .catch(() => {
        // Subscribe failed; remove the placeholder so a later acquire can
        // retry — but only if our generation is still current. Otherwise a
        // newer acquire owns the slot and we must not delete it.
        const live = get().liveWatchers[repoRootFs]
        if (!live || live.generation !== generation) return
        set((s) => {
          const next = { ...s.liveWatchers }
          delete next[repoRootFs]
          return { liveWatchers: next }
        })
      })
  },

  releaseWatcher: (repoRootFs) => {
    const cur = get().liveWatchers[repoRootFs]
    if (!cur) return
    if (cur.refCount > 1) {
      set((s) => ({
        liveWatchers: {
          ...s.liveWatchers,
          [repoRootFs]: { ...cur, refCount: cur.refCount - 1 }
        }
      }))
      return
    }
    // Already on the way out (refCount: 0 + timer pending) — extra release
    // calls are a no-op so we don't schedule duplicate teardowns.
    if (cur.refCount === 0 && cur.teardownTimer) return
    // Last ref — schedule a delayed teardown. If something acquires in the
    // meantime, the timer is cleared. We bump generation so any orphaned
    // timer that survives a clearTimeout-race gets filtered out.
    const generation = ++nextWatcherGen
    const timer = setTimeout(() => {
      const live = get().liveWatchers[repoRootFs]
      if (!live || live.generation !== generation) return
      if (live.token) {
        window.dplex.diff.unsubscribe(live.token)
      }
      set((s) => {
        const next = { ...s.liveWatchers }
        delete next[repoRootFs]
        return { liveWatchers: next }
      })
    }, TEARDOWN_GRACE_MS)
    set((s) => ({
      liveWatchers: {
        ...s.liveWatchers,
        [repoRootFs]: { ...cur, refCount: 0, generation, teardownTimer: timer }
      }
    }))
  },

  openFile: (project, file, opts) => {
    const root = get().resolveActiveRoot(project)
    const promote = opts?.promote === true
    useTerminalStore.getState().openOrFocusDiffTab({
      repoRootFs: root,
      repoLabel: project.name,
      scope: { kind: 'workingTree' },
      file,
      preview: !promote
    })
    useProjectStore.getState().setProjectGitState(project.id, { selectedGitPath: file.gitPath })
  },

  reset: () => {
    const watchers = get().liveWatchers
    for (const w of Object.values(watchers)) {
      if (w.teardownTimer) clearTimeout(w.teardownTimer)
      if (w.token) window.dplex.diff.unsubscribe(w.token)
    }
    set({ byRepo: {}, liveWatchers: {}, loading: {} })
  }
}))

/**
 * Wires global side-effects exactly once:
 *  - Listens for repo "changes-changed" events and refreshes the relevant
 *    cache entry without resetting the persisted selection.
 *  - Tracks the active project and binds/unbinds the watcher accordingly.
 *  - On project deletion, releases the watcher and closes any preview
 *    tabs scoped to the deleted repo.
 */
let wired = false
export function wireGitPanelGlobals(): () => void {
  if (wired) return () => undefined
  wired = true

  // Coalesce rapid fs events per repo. Without this, a burst of file
  // changes (e.g., during a build) triggers a refresh per event and the
  // "Refreshing…" indicator flickers on every cycle. Trailing-edge fire
  // means the user always gets the *latest* state, but only one fetch
  // per quiet interval.
  const REFRESH_DEBOUNCE_MS = 600
  const pendingTimers = new Map<string, number>()
  const offChanges = window.dplex.diff.onChangesChanged((p) => {
    const repoRoot = p.repoRootFs
    const existing = pendingTimers.get(repoRoot)
    if (existing !== undefined) window.clearTimeout(existing)
    const t = window.setTimeout(() => {
      pendingTimers.delete(repoRoot)
      const store = useGitPanelStore.getState()
      const cur = store.byRepo[repoRoot]
      if (!cur) return
      const projects = useProjectStore.getState().projects
      const owners = projects.filter((proj) => store.resolveActiveRoot(proj) === repoRoot)
      if (owners.length === 0) return
      store.bindToProject(owners[0].id, { force: true })
    }, REFRESH_DEBOUNCE_MS)
    pendingTimers.set(repoRoot, t)
  })

  // Watcher lifecycle is owned EXCLUSIVELY by this subscription.
  // bindToProject/refresh are pure-fetch; this is the only place that
  // calls acquireWatcher/releaseWatcher for the active project.
  let prevRoot: string | null = null
  const initState = useProjectStore.getState()
  const initProj = initState.projects.find((p) => p.id === initState.activeProjectId) ?? null
  if (initProj) {
    const store = useGitPanelStore.getState()
    prevRoot = store.resolveActiveRoot(initProj)
    store.acquireWatcher(prevRoot)
    store.bindToProject(initProj.id)
  }

  const unsubProj = useProjectStore.subscribe((state, prevState) => {
    if (state.activeProjectId === prevState.activeProjectId) return
    const store = useGitPanelStore.getState()
    const newProj = state.projects.find((p) => p.id === state.activeProjectId) ?? null
    const newRoot = newProj ? store.resolveActiveRoot(newProj) : null
    if (newRoot !== prevRoot) {
      if (prevRoot) store.releaseWatcher(prevRoot)
      if (newRoot) store.acquireWatcher(newRoot)
    }
    if (newProj) {
      store.bindToProject(newProj.id)
    }
    prevRoot = newRoot
  })

  // Detect project deletions and clean up.
  let prevProjectIds = new Set(useProjectStore.getState().projects.map((p) => p.id))
  const unsubProjList = useProjectStore.subscribe((state) => {
    const ids = new Set(state.projects.map((p) => p.id))
    if (ids.size === prevProjectIds.size) {
      let same = true
      for (const id of ids) {
        if (!prevProjectIds.has(id)) {
          same = false
          break
        }
      }
      if (same) return
    }
    // Find removed roots that are no longer represented by any project.
    const store = useGitPanelStore.getState()
    const liveRoots = Object.keys(store.liveWatchers)
    const stillReferenced = new Set(state.projects.map((p) => store.resolveActiveRoot(p)))
    for (const root of liveRoots) {
      if (!stillReferenced.has(root)) {
        // Forcibly tear down — orphaned root has no remaining owner.
        store.releaseWatcher(root)
        // Close any preview tabs scoped to this root; permanent tabs stay.
        const term = useTerminalStore.getState()
        for (const g of term.groups) {
          for (const t of g.tabs) {
            if (t.kind === 'fileDiff' && t.repoRootFs === root && t.preview === true) {
              term.closeTerminal(t.id)
            }
          }
        }
      }
    }
    prevProjectIds = ids
  })

  return () => {
    offChanges()
    for (const t of pendingTimers.values()) window.clearTimeout(t)
    pendingTimers.clear()
    unsubProj()
    unsubProjList()
    if (prevRoot) {
      useGitPanelStore.getState().releaseWatcher(prevRoot)
      prevRoot = null
    }
    wired = false
  }
}
