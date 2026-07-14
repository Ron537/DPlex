import { create } from 'zustand'
import type { FsEntry } from '../../../preload/index'
import { useProjectStore } from './projectStore'
import { useTerminalStore } from './terminalStore'
import { setCanonicalRoot, clearCanonicalRoot, watchRootMatches } from './fileWatchRoots'
import { hasParkedEditorBuffer } from '../services/parkedEditorBuffers'
import { syncBackgroundEditorTabsOnRename } from './spaceStore'
import type { Project } from '../types'

/**
 * Store backing the file explorer panel. Bounded to a SINGLE active project
 * root at a time (the selected project's own `path` — never expanded to a git
 * repo root, unlike the diff panel). Maintains a lazy directory cache and an
 * expanded-dir set per root, and owns exactly ONE filesystem tree watcher for
 * the active root (no per-tab/per-node watchers — see design notes).
 */

interface RootState {
  /** Directory listings keyed by project-relative POSIX path (`''` = root). */
  byDir: Record<string, FsEntry[]>
  /** Expanded directories keyed by relPath. */
  expanded: Record<string, boolean>
  /** Per-dir loading flag. */
  loading: Record<string, boolean>
  /** Per-dir error message (e.g. permission denied). */
  error: Record<string, string | null>
}

function emptyRootState(): RootState {
  return { byDir: {}, expanded: { '': true }, loading: {}, error: {} }
}

interface FileExplorerState {
  /** Canonical active project root, or null when none is selected. */
  activeRootFs: string | null
  /** Display label (project name) for tab/header parity. */
  activeRootLabel: string
  /** Per-root UI/cache state, keyed by rootFs. */
  roots: Record<string, RootState>
  /** Currently selected entry relPath (for highlight). */
  selectedRelPath: string | null

  /** Bind the explorer to a project (sets active root, ensures root listing). */
  bindToProject: (project: Project | null) => void
  /** Load (or reload) a directory's children for the active root. */
  loadDir: (relPath: string, opts?: { force?: boolean }) => void
  /** Expand/collapse a directory; lazy-loads children on first expand. */
  toggleDir: (relPath: string) => void
  /** Reload every currently-cached directory for the active root. */
  refresh: () => void
  /** Collapse all expanded directories (keeps the root listing). */
  collapseAll: () => void
  /** Reload only the named dirs (used by the watcher) for the active root. */
  refreshDirs: (rootFs: string, dirs: string[]) => void
  /** Select a file row (highlight) without opening it. */
  select: (relPath: string) => void
  /** Open a file in an editor tab (single-click preview / double-click persist). */
  openFile: (relPath: string, opts?: { promote?: boolean }) => void

  // Mutations (all bounded to the active root).
  createFile: (parentRelPath: string, name: string) => Promise<{ ok: boolean; message?: string }>
  createDir: (parentRelPath: string, name: string) => Promise<{ ok: boolean; message?: string }>
  rename: (relPath: string, newName: string) => Promise<{ ok: boolean; message?: string }>
  deletePath: (relPath: string) => Promise<{ ok: boolean; message?: string }>
}

/** POSIX dirname for a project-relative path (`'a/b/c'` → `'a/b'`, `'a'` → `''`). */
function parentRel(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  activeRootFs: null,
  activeRootLabel: '',
  roots: {},
  selectedRelPath: null,

  bindToProject: (project) => {
    if (!project) {
      set({ activeRootFs: null, activeRootLabel: '' })
      return
    }
    const root = project.path
    const existing = get().roots[root]
    set((s) => ({
      activeRootFs: root,
      activeRootLabel: project.name,
      roots: existing ? s.roots : { ...s.roots, [root]: emptyRootState() }
    }))
    // Always (re)load the root listing on bind so a freshly selected project
    // reflects on-disk state.
    get().loadDir('', { force: true })
  },

  loadDir: (relPath, opts) => {
    const root = get().activeRootFs
    if (!root) return
    const rootState = get().roots[root] ?? emptyRootState()
    if (!opts?.force && rootState.byDir[relPath]) return
    set((s) =>
      updateRoot(s, root, (rs) => ({
        ...rs,
        loading: { ...rs.loading, [relPath]: true },
        error: { ...rs.error, [relPath]: null }
      }))
    )
    window.dplex.files
      .listDir(root, relPath)
      .then((res) => {
        // Ignore late responses for a root that is no longer active.
        if (get().activeRootFs !== root) return
        set((s) =>
          updateRoot(s, root, (rs) => ({
            ...rs,
            loading: { ...rs.loading, [relPath]: false },
            byDir: res.ok ? { ...rs.byDir, [relPath]: res.entries } : rs.byDir,
            error: { ...rs.error, [relPath]: res.ok ? null : (res.code ?? 'IO_ERROR') }
          }))
        )
      })
      .catch(() => {
        if (get().activeRootFs !== root) return
        set((s) =>
          updateRoot(s, root, (rs) => ({
            ...rs,
            loading: { ...rs.loading, [relPath]: false },
            error: { ...rs.error, [relPath]: 'IO_ERROR' }
          }))
        )
      })
  },

  toggleDir: (relPath) => {
    const root = get().activeRootFs
    if (!root) return
    const rs = get().roots[root]
    if (!rs) return
    const willExpand = !rs.expanded[relPath]
    set((s) =>
      updateRoot(s, root, (r) => ({
        ...r,
        expanded: { ...r.expanded, [relPath]: willExpand }
      }))
    )
    if (willExpand) get().loadDir(relPath)
  },

  refresh: () => {
    const root = get().activeRootFs
    if (!root) return
    const rs = get().roots[root]
    if (!rs) return
    for (const dir of Object.keys(rs.byDir)) get().loadDir(dir, { force: true })
  },

  collapseAll: () => {
    const root = get().activeRootFs
    if (!root) return
    set((s) => updateRoot(s, root, (rs) => ({ ...rs, expanded: { '': true } })))
  },

  refreshDirs: (rootFs, dirs) => {
    const active = get().activeRootFs
    if (!watchRootMatches(rootFs, active) || !active) return
    const rs = get().roots[active]
    if (!rs) return
    for (const dir of dirs) {
      // Only reload dirs we have actually cached (visible/expanded).
      if (rs.byDir[dir] !== undefined) get().loadDir(dir, { force: true })
    }
  },

  select: (relPath) => set({ selectedRelPath: relPath }),

  openFile: (relPath, opts) => {
    const root = get().activeRootFs
    if (!root) return
    set({ selectedRelPath: relPath })
    useTerminalStore.getState().openOrFocusFileTab({
      rootFs: root,
      rootLabel: get().activeRootLabel,
      relPath,
      preview: opts?.promote ? false : true
    })
  },

  createFile: async (parentRelPath, name) => {
    const root = get().activeRootFs
    if (!root || !name.trim()) return { ok: false, message: 'INVALID_INPUT' }
    const rel = joinRel(parentRelPath, name.trim())
    const res = await window.dplex.files.createFile(root, rel)
    if (res.ok) {
      get().loadDir(parentRelPath, { force: true })
      get().openFile(res.relPath ?? rel, { promote: true })
    }
    return { ok: res.ok, message: res.code }
  },

  createDir: async (parentRelPath, name) => {
    const root = get().activeRootFs
    if (!root || !name.trim()) return { ok: false, message: 'INVALID_INPUT' }
    const rel = joinRel(parentRelPath, name.trim())
    const res = await window.dplex.files.createDir(root, rel)
    if (res.ok) {
      get().loadDir(parentRelPath, { force: true })
      set((s) =>
        updateRoot(s, root, (rs) => ({
          ...rs,
          expanded: { ...rs.expanded, [parentRelPath]: true }
        }))
      )
    }
    return { ok: res.ok, message: res.code }
  },

  rename: async (relPath, newName) => {
    const root = get().activeRootFs
    if (!root || !newName.trim()) return { ok: false, message: 'INVALID_INPUT' }
    const parent = parentRel(relPath)
    const target = joinRel(parent, newName.trim())
    if (target === relPath) return { ok: true }
    const res = await window.dplex.files.rename(root, relPath, target)
    if (res.ok) {
      get().loadDir(parent, { force: true })
      syncTabsOnRename(root, relPath, res.relPath ?? target)
    }
    return { ok: res.ok, message: res.code }
  },

  deletePath: async (relPath) => {
    const root = get().activeRootFs
    if (!root) return { ok: false, message: 'INVALID_INPUT' }
    const res = await window.dplex.files.delete(root, relPath)
    if (res.ok) {
      get().loadDir(parentRel(relPath), { force: true })
      syncTabsOnDelete(root, relPath)
    }
    return { ok: res.ok, message: res.code }
  }
}))

/** Immutably update one root's state. */
function updateRoot(
  state: FileExplorerState,
  root: string,
  fn: (rs: RootState) => RootState
): Partial<FileExplorerState> {
  const cur = state.roots[root] ?? emptyRootState()
  return { roots: { ...state.roots, [root]: fn(cur) } }
}

/**
 * Update open editor tabs after a rename. A direct file rename updates the
 * matching tab; a folder rename rewrites every descendant tab's path/title.
 */
function syncTabsOnRename(root: string, fromRel: string, toRel: string): void {
  const term = useTerminalStore.getState()
  const fromPrefix = fromRel + '/'
  for (const g of term.groups) {
    for (const t of g.tabs) {
      if (t.kind !== 'fileEditor' || t.rootFs !== root) continue
      if (t.relPath === fromRel) {
        term.updateFileEditorTab(t.id, { relPath: toRel, title: basename(toRel) })
      } else if (t.relPath.startsWith(fromPrefix)) {
        const next = toRel + '/' + t.relPath.slice(fromPrefix.length)
        term.updateFileEditorTab(t.id, { relPath: next, title: basename(next) })
      }
    }
  }
  // Mirror the rename into background spaces' stashed snapshots too, so a
  // renamed file doesn't read as "missing" (or get recreated at its old path by
  // a stashed unsaved buffer) when one of those spaces is later resumed.
  syncBackgroundEditorTabsOnRename(root, fromRel, toRel)
}

/**
 * After a delete, close clean editor tabs for the path (or its descendants).
 * Dirty tabs — including an editor holding a stashed parked buffer (unsaved
 * edits from a backgrounded Space) — are left open so the editor can surface a
 * "file missing" state rather than silently dropping unsaved work.
 */
function syncTabsOnDelete(root: string, relPath: string): void {
  const term = useTerminalStore.getState()
  const prefix = relPath + '/'
  for (const g of term.groups) {
    for (const t of g.tabs) {
      if (t.kind !== 'fileEditor' || t.rootFs !== root) continue
      const match = t.relPath === relPath || t.relPath.startsWith(prefix)
      if (match && t.dirty !== true && !hasParkedEditorBuffer(t.id)) term.closeTerminal(t.id)
    }
  }
}

function basename(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(i + 1) : relPath
}

let wired = false
let activeWatcherToken: string | null = null
let watchedRoot: string | null = null
let acquireGen = 0

/**
 * Wire global subscriptions: follow the active project and maintain exactly
 * one filesystem watcher for the active root. Returns a teardown fn.
 */
export function wireFileExplorerGlobals(): () => void {
  if (wired) return () => undefined
  wired = true

  const acquire = (root: string | null): void => {
    if (root === watchedRoot) return
    const gen = ++acquireGen
    if (activeWatcherToken) {
      window.dplex.files.unsubscribe(activeWatcherToken)
      activeWatcherToken = null
    }
    if (watchedRoot) clearCanonicalRoot(watchedRoot)
    watchedRoot = root
    if (!root) return
    const target = root
    window.dplex.files
      .subscribe(target)
      .then((res) => {
        // A newer acquire may have superseded us while awaiting; compare the
        // generation (not just the root) so out-of-order resolutions for the same
        // root can't leak a watcher token.
        if (gen !== acquireGen || watchedRoot !== target) {
          if (res) window.dplex.files.unsubscribe(res.token)
          return
        }
        activeWatcherToken = res ? res.token : null
        if (res) setCanonicalRoot(target, res.rootFs)
      })
      .catch((err) => {
        // Subscribe can reject if the root is stale/invalid by the time main
        // resolves it. Leave the token null and log; the focus-refresh fallback
        // below still lets the user recover external changes manually.
        if (gen === acquireGen && watchedRoot === target) activeWatcherToken = null
        console.warn('[explorer] files.subscribe failed', err)
      })
  }

  const offTree = window.dplex.files.onTreeChanged((p) => {
    useFileExplorerStore.getState().refreshDirs(p.rootFs, p.dirs)
  })

  // Fallback for platforms/cases where the recursive watcher misses nested
  // changes (notably Linux, which only supports a shallow root watch): when the
  // window regains focus, re-stat every cached directory. `refresh()` is bounded
  // to already-loaded dirs, so this stays cheap.
  const onFocus = (): void => {
    useFileExplorerStore.getState().refresh()
  }
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') onFocus()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)

  const bindCurrent = (): void => {
    const ps = useProjectStore.getState()
    const proj = ps.projects.find((p) => p.id === ps.activeProjectId) ?? null
    useFileExplorerStore.getState().bindToProject(proj)
    acquire(proj ? proj.path : null)
  }

  bindCurrent()

  const unsubProj = useProjectStore.subscribe((state, prev) => {
    if (state.activeProjectId === prev.activeProjectId) return
    bindCurrent()
  })

  return () => {
    offTree()
    unsubProj()
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    if (activeWatcherToken) {
      window.dplex.files.unsubscribe(activeWatcherToken)
      activeWatcherToken = null
    }
    if (watchedRoot) clearCanonicalRoot(watchedRoot)
    watchedRoot = null
    wired = false
  }
}
