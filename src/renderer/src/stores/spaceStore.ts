import { create } from 'zustand'
import type { EditorTab, Space, WorkspaceSnapshot } from '../types'
import { isTerminalTab } from '../types'
import {
  EMPTY_WORKSPACE,
  reconstructWorkspace,
  serializeWorkspaceSnapshot,
  type PersistedWorkspaceSnapshot
} from '../utils/workspaceSnapshot'
import { DEFAULT_SPACE_COLOR, pickSpaceColor } from '../utils/spaceColors'
import { findProjectForTab } from '../utils/tabProject'
import { pruneLayoutToGroups } from '../utils/tabFocus'
import { useTerminalStore, setWorkspaceSink } from './terminalStore'
import { useProjectStore } from './projectStore'
import { useSessionStore } from './sessionStore'
import { destroyTerminal, cancelExitHandler } from '../services/terminalRegistry'
import { stashAllDirtyFileEditors, isFileEditorDirty } from '../services/fileEditorRegistry'
import { clearParkedEditorBuffer, hasParkedEditorBuffer } from '../services/parkedEditorBuffers'

const SPACES_VERSION = 1

/** On-disk Space — identity fields plus the lossy (persisted) workspace. */
interface PersistedSpace {
  id: string
  name: string
  color: string
  glyph?: string
  projectIds: string[]
  workspace: PersistedWorkspaceSnapshot
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  archived?: boolean
}

interface PersistedSpacesFile {
  version: number
  spaces: PersistedSpace[]
  activeSpaceId: string | null
}

interface CreateSpaceOptions {
  name: string
  color?: string
  glyph?: string
  projectIds?: string[]
  /** Switch focus to the new space (auto-backgrounding the current one).
   *  Defaults to true. */
  activate?: boolean
}

export interface SpaceState {
  spaces: Space[]
  activeSpaceId: string | null
  loaded: boolean
  /** Load + migrate spaces, install the persistence sink, and restore the
   *  active space's workspace into the terminal store. Runs once at boot. */
  hydrate: () => Promise<void>
  createSpace: (opts: CreateSpaceOptions) => string
  renameSpace: (id: string, name: string) => void
  setSpaceAppearance: (id: string, patch: { color?: string; glyph?: string | null }) => void
  assignProjects: (id: string, projectIds: string[]) => void
  /** Bind a single project to a space, appended after the existing ones so the
   *  primary (projectIds[0]) is never displaced. No-op when the space is gone
   *  or already includes the project. Used when work for an unbound project is
   *  started from within a space. */
  addProjectToSpace: (id: string, projectId: string) => void
  /** Remove a project id from every space that references it (called when the
   *  project is deleted from the Projects panel) so no space keeps a dangling
   *  binding. If the removed id was a space's primary (projectIds[0]), the next
   *  bound project becomes primary; the active space re-syncs the Projects/Git
   *  target. */
  pruneProject: (projectId: string) => void
  /** Bring a space into focus. The previous space auto-backgrounds (keeps
   *  running). Never restarts sessions. */
  switchSpace: (id: string) => void
  /** Move the current space out of focus → land on the Overview (no space in
   *  focus). The space keeps running in the background. */
  sendToBackground: () => void
  /** Re-focus the space that initiated a deferred tab creation (a worktree
   *  setup-script that finishes minutes later, a session resume whose command
   *  is still resolving) so the resulting terminal lands in that space even if
   *  the user switched away during the async gap. No-op when that space is
   *  already active, was deleted, or the work started from the Overview. */
  focusForDeferredWork: (originSpaceId: string | null) => void
  deleteSpace: (id: string) => void
  persist: () => void
  persistNow: () => void
}

let spaceIdCounter = 0
function makeSpaceId(): string {
  spaceIdCounter += 1
  return `space-${Date.now()}-${spaceIdCounter}-${Math.random().toString(36).slice(2, 6)}`
}

function makeSpace(opts: {
  name: string
  color?: string
  glyph?: string
  projectIds?: string[]
  workspace?: WorkspaceSnapshot
}): Space {
  const now = Date.now()
  return {
    id: makeSpaceId(),
    name: opts.name,
    color: opts.color ?? DEFAULT_SPACE_COLOR,
    glyph: opts.glyph,
    projectIds: opts.projectIds ?? [],
    workspace: opts.workspace ?? EMPTY_WORKSPACE,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  }
}

/** Drive the Projects panel / Git target from a space's primary project. */
function syncActiveProject(space: Space | null): void {
  const primary = space?.projectIds[0] ?? null
  useProjectStore.getState().setActiveProject(primary)
}

/** Last path segment, tolerant of both POSIX and Windows separators. */
function basenameOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

/** Order a snapshot's tabs so the one the user is actually looking at (the
 *  active group's active tab) is considered first when naming an adopted
 *  space. */
function orderedTabsForNaming(snap: WorkspaceSnapshot): EditorTab[] {
  const activeGroup = snap.groups.find((g) => g.id === snap.activeGroupId) ?? snap.groups[0]
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  const rest = snap.groups.flatMap((g) => g.tabs).filter((t) => t !== activeTab)
  return activeTab ? [activeTab, ...rest] : rest
}

/** Next unused "Untitled Space N" name (1-based), scanning existing space names
 *  so consecutively auto-created spaces don't collide (Untitled Space 1, 2, …). */
function nextUntitledSpaceName(existing: Space[]): string {
  let max = 0
  for (const s of existing) {
    const m = /^Untitled Space (\d+)$/.exec(s.name.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `Untitled Space ${max + 1}`
}

/** Derive the seed for a space auto-created when work starts without a space
 *  selected (from the Overview, or during the async boot window). The space gets
 *  a neutral "Untitled Space N" name — the user renames it when they want — but
 *  is still bound to the triggering tab's project when there is one, so its
 *  Projects/Git panel isn't empty. */
function deriveOrphanSpaceSeed(
  snap: WorkspaceSnapshot,
  existing: Space[]
): { name: string; projectIds: string[] } {
  const name = nextUntitledSpaceName(existing)
  const projects = useProjectStore.getState().projects
  for (const t of orderedTabsForNaming(snap)) {
    const proj = findProjectForTab(t, projects)
    if (proj) return { name, projectIds: [proj.id] }
  }
  return { name, projectIds: [] }
}

/** Tear down every terminal belonging to a workspace snapshot: close its AI
 *  session on disk (if any) and destroy the PTY + xterm instance. Used when a
 *  space is deleted — its background terminals must not leak. */
function teardownWorkspaceTerminals(snap: WorkspaceSnapshot): void {
  for (const g of snap.groups) {
    for (const t of g.tabs) {
      if (!isTerminalTab(t)) {
        // A deleted space's editors never remount, so drop any unsaved buffer
        // stashed while it was parked (otherwise it would leak).
        clearParkedEditorBuffer(t.id)
        continue
      }
      if (t.sessionId && t.providerId) {
        void window.dplex.sessions.close(t.sessionId, t.providerId).catch(() => {
          // Provider may fail if the session is already gone — ignore.
        })
        useSessionStore.getState().clearLiveTabTitle(t.providerId, t.sessionId)
      }
      // Drop any pending exit handler (e.g. a still-running worktree setup
      // script) BEFORE destroying the PTY: destroyTerminal fires exit handlers,
      // and a setup script's handler would re-focus this (being-deleted) Space
      // and spawn its afterCreate session/terminal into it — leaving a dangling
      // activeSpaceId and an orphan tab. The setup temp file is left for the OS
      // to reap in this rare delete-mid-setup case.
      cancelExitHandler(t.id)
      destroyTerminal(t.id)
    }
  }
}

/** Adopt whatever live work currently sits in the terminal store — started from
 *  the Overview, or during the async boot window before any space was focused —
 *  into a fresh space so its tabs (and running PTYs) are preserved rather than
 *  swapped away and lost. Returns the new space, or null when the store holds no
 *  tabs. `activate` focuses the new space (the Overview safety-net path); pass
 *  false to keep it in the background — used when the user is switching to a
 *  *different* space, so the orphaned work is preserved out of focus instead of
 *  being discarded by the incoming swapWorkspace. */
function adoptCurrentWorkAsSpace(activate: boolean): Space | null {
  const term = useTerminalStore.getState()
  const snapshot: WorkspaceSnapshot = {
    groups: term.groups,
    layout: term.layout,
    activeGroupId: term.activeGroupId
  }
  if (!snapshot.groups.some((g) => g.tabs.length > 0)) return null
  const st = useSpaceStore.getState()
  const seed = deriveOrphanSpaceSeed(snapshot, st.spaces)
  const space = makeSpace({
    name: seed.name,
    color: pickSpaceColor(st.spaces),
    projectIds: seed.projectIds,
    workspace: snapshot
  })
  useSpaceStore.setState(
    activate
      ? { spaces: [...st.spaces, space], activeSpaceId: space.id }
      : { spaces: [...st.spaces, space] }
  )
  if (activate) syncActiveProject(space)
  useSpaceStore.getState().persist()
  return space
}

/** Build the on-disk file. The active space's workspace is read live from the
 *  terminal store (source of truth); background spaces use their stashed
 *  snapshot. */
function buildPersistedFile(state: SpaceState): PersistedSpacesFile {
  const activeId = state.activeSpaceId
  const spaces: PersistedSpace[] = state.spaces.map((s) => {
    const snap = s.id === activeId ? useTerminalStore.getState().snapshotWorkspace() : s.workspace
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      glyph: s.glyph,
      projectIds: s.projectIds,
      workspace: serializeWorkspaceSnapshot(snap),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastActiveAt: s.lastActiveAt,
      archived: s.archived
    }
  })
  return { version: SPACES_VERSION, spaces, activeSpaceId: activeId }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],
  activeSpaceId: null,
  loaded: false,

  hydrate: async () => {
    if (get().loaded) return

    const installSink = (): void =>
      setWorkspaceSink({ save: () => get().persist(), saveSync: () => get().persistNow() })

    // Adopt any workspace the user started during the async boot window: the
    // Projects/Sessions sidebar stays interactive while spaces load, and the
    // orphan-adoption net below is dormant until `loaded`. Without this, the
    // pending swapWorkspace would discard that work (and leak its PTYs). Keeps
    // the just-loaded spaces (`background`) alive in the background. Returns true
    // when it takes over hydration — the caller must then stop.
    const adoptEarlyWork = (background: Space[]): boolean => {
      const early = useTerminalStore.getState().snapshotWorkspace()
      if (!early.groups.some((g) => g.tabs.length > 0)) return false

      // Any space the user explicitly created during the boot window (its id is
      // fresh, so it isn't among the just-loaded `background` set).
      const pending = get().spaces.filter((p) => !background.some((b) => b.id === p.id))

      // If the user created AND activated a space during that window, the live
      // terminal work IS that space's work — attach it there rather than spinning
      // up a throwaway "adopted" space, which would leave the created space empty
      // and detach the user's work from the space they made for it.
      const activeId = get().activeSpaceId
      const activePending = activeId ? pending.find((p) => p.id === activeId) : undefined
      if (activePending) {
        const now = Date.now()
        const merged: Space = {
          ...activePending,
          workspace: early,
          updatedAt: now,
          lastActiveAt: now
        }
        set({
          spaces: [...background, ...pending.map((p) => (p.id === merged.id ? merged : p))],
          activeSpaceId: merged.id,
          loaded: true
        })
        installSink()
        syncActiveProject(merged)
        get().persist()
        return true
      }

      // Otherwise the work is genuinely orphaned (no space was created for it) —
      // wrap it in a freshly named, project-bound space and make it active.
      const seed = deriveOrphanSpaceSeed(early, [...background, ...pending])
      const adopted = makeSpace({
        name: seed.name,
        color: pickSpaceColor(background),
        projectIds: seed.projectIds,
        workspace: early
      })
      set({
        spaces: [...background, ...pending, adopted],
        activeSpaceId: adopted.id,
        loaded: true
      })
      installSink()
      syncActiveProject(adopted)
      get().persist()
      return true
    }

    let file: Awaited<ReturnType<typeof window.dplex.spaces.load>> = null
    try {
      file = await window.dplex.spaces.load()
    } catch {
      file = null
    }

    // Commit any space(s) the user created during the async load window when
    // there is no persisted file to merge them into (absent/corrupt/unsupported,
    // or a load error). Their live workspace is already in the terminal store,
    // so don't swap anything — just mark loaded and persist. adoptEarlyWork only
    // rescues started terminal work, so without this a freshly created empty
    // space would be clobbered by the "My Work" seed below.
    const commitPendingSpaces = (): boolean => {
      if (get().spaces.length === 0) return false
      set({ loaded: true })
      installSink()
      get().persist()
      return true
    }

    // Drop any malformed (non-object or array) entries so a corrupt file can't
    // crash the reconstruction below or resurrect as a bogus empty space (the
    // main-process validator rejects non-objects too, but an array element
    // slips past its `typeof === 'object'` check).
    const validSpaces =
      file && Array.isArray(file.spaces)
        ? file.spaces.filter(
            (ps): ps is PersistedSpace => !!ps && typeof ps === 'object' && !Array.isArray(ps)
          )
        : []

    // Fresh install (no usable spaces file, no legacy workspace): seed one empty
    // space so the app opens ready to work — unless the user already started
    // something. A file that exists but has zero spaces is NOT a fresh install
    // (the user deleted them all); that is honoured as the Overview below, so we
    // don't resurrect a space they intentionally removed.
    if (!file) {
      if (adoptEarlyWork([])) return
      if (commitPendingSpaces()) return
      const seed = makeSpace({ name: 'My Work' })
      set({ spaces: [seed], activeSpaceId: seed.id, loaded: true })
      installSink()
      return
    }

    try {
      // Reconstruct each space's live workspace from its persisted form. AI tabs
      // are prepared with fresh resume commands but no PTYs spawn until a space's
      // tabs actually mount (i.e. when it comes into focus).
      const spaces: Space[] = await Promise.all(
        validSpaces.map(async (ps) => {
          const workspace =
            (await reconstructWorkspace(
              ps.workspace as Parameters<typeof reconstructWorkspace>[0]
            )) ?? EMPTY_WORKSPACE
          return {
            id: typeof ps.id === 'string' && ps.id ? ps.id : makeSpaceId(),
            name: typeof ps.name === 'string' && ps.name ? ps.name : 'Space',
            color: typeof ps.color === 'string' && ps.color ? ps.color : DEFAULT_SPACE_COLOR,
            glyph: typeof ps.glyph === 'string' ? ps.glyph : undefined,
            projectIds: Array.isArray(ps.projectIds) ? ps.projectIds : [],
            workspace,
            createdAt: ps.createdAt ?? Date.now(),
            updatedAt: ps.updatedAt ?? Date.now(),
            lastActiveAt: ps.lastActiveAt ?? Date.now(),
            archived: ps.archived
          }
        })
      )

      // Keep any work the user started while we were loading (as the new active
      // space); leave the loaded spaces in the background — never clobber it.
      if (adoptEarlyWork(spaces)) return

      // Preserve any space the user explicitly created during the async load
      // window (the sidebar stays interactive; adoptEarlyWork only rescues
      // started *terminal* work, not a freshly created empty space). Their
      // in-window activation also wins over the stale persisted pointer.
      const pending = get().spaces
      const pendingActiveId = get().activeSpaceId
      const mergedSpaces = pending.length > 0 ? [...spaces, ...pending] : spaces
      const pendingIsActive = !!pendingActiveId && pending.some((s) => s.id === pendingActiveId)

      const activeSpaceId: string | null = pendingIsActive
        ? pendingActiveId
        : file.activeSpaceId && spaces.some((s) => s.id === file.activeSpaceId)
          ? file.activeSpaceId
          : null

      set({ spaces: mergedSpaces, activeSpaceId, loaded: true })
      installSink()

      // Restore the persisted active space's arrangement — but not when a space
      // created during the window is already active (its arrangement is already
      // live in the terminal store; swapping would discard it).
      if (!pendingIsActive) {
        const active = spaces.find((s) => s.id === activeSpaceId) ?? null
        if (active) {
          useTerminalStore.getState().swapWorkspace(active.workspace)
          syncActiveProject(active)
        }
      }
      if (pending.length > 0) get().persist()
    } catch {
      // A corrupt/unsupported file must never brick the app. Preserve any early
      // work, else fall back to a fresh space (the on-disk file is left as-is
      // until the next real workspace change persists over it).
      if (get().loaded) return
      if (adoptEarlyWork([])) return
      if (commitPendingSpaces()) return
      const seed = makeSpace({ name: 'My Work' })
      set({ spaces: [seed], activeSpaceId: seed.id, loaded: true })
      installSink()
    }
  },

  createSpace: (opts) => {
    const activate = opts.activate !== false
    const space = makeSpace({
      name: opts.name.trim() || 'New Space',
      color: opts.color ?? pickSpaceColor(get().spaces),
      glyph: opts.glyph,
      projectIds: opts.projectIds
    })
    set((state) => ({ spaces: [...state.spaces, space] }))
    if (activate) {
      get().switchSpace(space.id)
    } else {
      get().persist()
    }
    return space.id
  },

  renameSpace: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({
      spaces: state.spaces.map((s) =>
        s.id === id ? { ...s, name: trimmed, updatedAt: Date.now() } : s
      )
    }))
    get().persist()
  },

  setSpaceAppearance: (id, patch) => {
    set((state) => ({
      spaces: state.spaces.map((s) =>
        s.id === id
          ? {
              ...s,
              color: patch.color ?? s.color,
              glyph: patch.glyph === null ? undefined : (patch.glyph ?? s.glyph),
              updatedAt: Date.now()
            }
          : s
      )
    }))
    get().persist()
  },

  assignProjects: (id, projectIds) => {
    const deduped = Array.from(new Set(projectIds))
    set((state) => ({
      spaces: state.spaces.map((s) =>
        s.id === id ? { ...s, projectIds: deduped, updatedAt: Date.now() } : s
      )
    }))
    // If reassigning the active space, keep the Projects panel in sync.
    if (get().activeSpaceId === id) {
      const space = get().spaces.find((s) => s.id === id) ?? null
      syncActiveProject(space)
    }
    get().persist()
  },

  addProjectToSpace: (id, projectId) => {
    const space = get().spaces.find((s) => s.id === id)
    if (!space || space.projectIds.includes(projectId)) return
    set((state) => ({
      spaces: state.spaces.map((s) =>
        s.id === id ? { ...s, projectIds: [...s.projectIds, projectId], updatedAt: Date.now() } : s
      )
    }))
    get().persist()
  },

  pruneProject: (projectId) => {
    const state = get()
    if (!state.spaces.some((s) => s.projectIds.includes(projectId))) return
    const now = Date.now()
    const activePrimaryBefore =
      state.spaces.find((s) => s.id === state.activeSpaceId)?.projectIds[0] ?? null
    const spaces = state.spaces.map((s) =>
      s.projectIds.includes(projectId)
        ? { ...s, projectIds: s.projectIds.filter((p) => p !== projectId), updatedAt: now }
        : s
    )
    set({ spaces })
    // Retarget the Projects panel / Git ONLY when the ACTIVE space's primary
    // project actually changed (its old primary was the pruned id). Removing a
    // project bound only to background spaces — or a non-primary member of the
    // active space — must not disturb the active tab's current project focus.
    const activeAfter = spaces.find((s) => s.id === state.activeSpaceId) ?? null
    if (activeAfter && (activeAfter.projectIds[0] ?? null) !== activePrimaryBefore) {
      syncActiveProject(activeAfter)
    }
    get().persist()
  },

  switchSpace: (id) => {
    const initial = get()
    if (initial.activeSpaceId === id) return
    if (!initial.spaces.some((s) => s.id === id)) return

    // Boot-window / Overview race guard: if nothing is in focus yet but the
    // terminal store already holds live work (an early restored session that
    // resolved before hydrate armed the orphan-adoption net, or work started on
    // the Overview), adopt it into a *background* space FIRST so swapping in the
    // target below never discards those tabs and their running PTYs. Re-read
    // state afterwards so the local `spaces` snapshot includes the adopted one.
    if (initial.activeSpaceId === null) adoptCurrentWorkAsSpace(false)

    const state = get()
    const target = state.spaces.find((s) => s.id === id)
    if (!target) return

    const terminal = useTerminalStore.getState()
    const now = Date.now()
    let spaces = state.spaces

    // Snapshot the outgoing space's live arrangement so it can be restored
    // verbatim later (it keeps running in the background).
    if (state.activeSpaceId) {
      const outgoing = terminal.snapshotWorkspace()
      spaces = spaces.map((s) =>
        s.id === state.activeSpaceId ? { ...s, workspace: outgoing, updatedAt: now } : s
      )
    }
    spaces = spaces.map((s) => (s.id === id ? { ...s, lastActiveAt: now } : s))

    // Mark the target active BEFORE swapping in its tabs. The orphan-adoption
    // safety net only runs while activeSpaceId===null; updating focus first
    // stops it from misfiring on the 0→>0 groups transition when switching in
    // from the Overview (which would burn a space id and double the
    // active-project sync before this set() clobbers it back).
    set({ spaces, activeSpaceId: id })

    // Bring the target into focus — swap in its arrangement (never destroys the
    // outgoing terminals; they detach and keep running). Stash the outgoing
    // space's unsaved editor buffers first so manual-save edits survive the
    // unmount and are restored when the space is resumed.
    stashAllDirtyFileEditors()
    terminal.swapWorkspace(target.workspace)
    syncActiveProject(spaces.find((s) => s.id === id) ?? null)
    get().persist()
  },

  sendToBackground: () => {
    const state = get()
    if (!state.activeSpaceId) return
    const terminal = useTerminalStore.getState()
    const now = Date.now()
    const outgoing = terminal.snapshotWorkspace()
    const spaces = state.spaces.map((s) =>
      s.id === state.activeSpaceId ? { ...s, workspace: outgoing, updatedAt: now } : s
    )
    // Clear focus → Overview. The space stays alive in the background. Stash
    // unsaved editor buffers first so they survive the unmount and restore on
    // resume.
    stashAllDirtyFileEditors()
    terminal.swapWorkspace(EMPTY_WORKSPACE)
    set({ spaces, activeSpaceId: null })
    useProjectStore.getState().setActiveProject(null)
    get().persist()
  },

  focusForDeferredWork: (originSpaceId) => {
    if (!originSpaceId) return
    const state = get()
    if (state.activeSpaceId === originSpaceId) return
    // The origin space was deleted while the async work ran. We deliberately do
    // NOT force focus anywhere here:
    //   • Common case — the origin was the *active* space when deleted, so we
    //     landed on the Overview (activeSpaceId=null). The next tab created trips
    //     the orphan-adoption net below, which spins up one fresh dedicated space
    //     AND keeps every later tab of the same deferred chain (a setup script,
    //     then the session it launches) together in that single space.
    //   • Rare case — the user manually switched to an unrelated space B during
    //     the async gap. The work then lands in B (still fully usable). Forcibly
    //     stealing focus would be more disruptive, and re-dropping focus per
    //     deferred tab would scatter a multi-tab chain across several spaces — so
    //     we leave it be.
    if (!state.spaces.some((s) => s.id === originSpaceId)) return
    get().switchSpace(originSpaceId)
  },

  deleteSpace: (id) => {
    const state = get()
    const space = state.spaces.find((s) => s.id === id)
    if (!space) return
    const isActive = state.activeSpaceId === id

    // Tear down the space's terminals (live snapshot if active, else stashed).
    const snap = isActive ? useTerminalStore.getState().snapshotWorkspace() : space.workspace
    teardownWorkspaceTerminals(snap)

    const spaces = state.spaces.filter((s) => s.id !== id)
    if (isActive) {
      // Land on the Overview; nothing else is force-activated.
      useTerminalStore.getState().swapWorkspace(EMPTY_WORKSPACE)
      set({ spaces, activeSpaceId: null })
      useProjectStore.getState().setActiveProject(null)
    } else {
      set({ spaces })
    }
    get().persist()
  },

  persist: () => {
    // Never write during the async boot window (before hydrate commits): a
    // debounced save fired by work started while loading could otherwise clobber
    // the real spaces.json with pending-only state before reconstruction lands.
    if (!get().loaded) return
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void window.dplex.spaces.save(buildPersistedFile(get()))
    }, 500)
  },

  persistNow: () => {
    // As with persist(): don't let a quit during the boot window overwrite the
    // on-disk file (still the source of truth until hydrate commits).
    if (!get().loaded) return
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    window.dplex.spaces.saveSync(buildPersistedFile(get()))
  }
}))

// Safety net: if tabs appear while no space is in focus (e.g. a session resumed
// or a terminal opened from the Overview), adopt them into a fresh space so
// nothing is orphaned or lost on reload. The space is named after the work that
// triggered it (its project / folder / session) — never a generic "Space N".
// Only fires on the 0 → >0 transition while activeSpaceId=null.
useTerminalStore.subscribe((s, prev) => {
  const st = useSpaceStore.getState()
  if (!st.loaded || st.activeSpaceId !== null) return
  if (prev.groups.length === 0 && s.groups.length > 0) {
    adoptCurrentWorkAsSpace(true)
  }
})

// Prune deleted projects from every space's binding. Fires only on a genuine
// removal (a project present in prev but gone in next), so store hydration —
// which only ADDS projects — can never false-prune a space whose project row
// simply hasn't loaded yet. pruneProject itself no-ops when nothing references
// the id, so this is cheap for the common add/reorder cases.
useProjectStore.subscribe((next, prev) => {
  if (next.projects === prev.projects || prev.projects.length <= next.projects.length) return
  const nextIds = new Set(next.projects.map((p) => p.id))
  for (const p of prev.projects) {
    if (!nextIds.has(p.id)) useSpaceStore.getState().pruneProject(p.id)
  }
})

/**
 * Patch a terminal tab that currently lives inside a *background* space's
 * stashed snapshot (not the active workspace, which the terminal store owns).
 * Used when session-id / OSC-title resolution completes while its space is in
 * the background — without this the resolved metadata would be written to the
 * active store (a no-op) and lost, breaking attention correlation and the
 * persisted resume command for that session. Returns true if the tab was found
 * and updated. The active workspace is intentionally skipped: its tabs are
 * mutated through the terminal store so the on-screen view stays in sync.
 */
export function patchBackgroundTab(
  terminalId: string,
  patch: { sessionId?: string; title?: string; pid?: number }
): boolean {
  let found = false
  let changed = false
  useSpaceStore.setState((state) => {
    const spaces = state.spaces.map((s) => {
      if (s.id === state.activeSpaceId) return s
      let touched = false
      const groups = s.workspace.groups.map((g) => {
        const target = g.tabs.find((t) => t.id === terminalId)
        if (!target) return g
        found = true
        // Skip tabs whose patched fields already match: backgrounded AI tools
        // re-emit the same OSC title every turn, and rebuilding the store +
        // scheduling a spaces.json write on each identical tick re-renders every
        // space surface for nothing.
        if (!patchChangesTab(target, patch)) return g
        touched = true
        changed = true
        return {
          ...g,
          tabs: g.tabs.map((t) => (t.id === terminalId ? { ...t, ...patch } : t))
        }
      })
      return touched ? { ...s, workspace: { ...s.workspace, groups } } : s
    })
    return changed ? { spaces } : {}
  })
  if (changed) useSpaceStore.getState().persist()
  return found
}

/** Whether applying `patch` would actually change any of the tab's fields. Used
 *  to no-op redundant background-tab updates (e.g. repeated identical OSC
 *  titles) so they don't churn the store or schedule a needless disk write. */
function patchChangesTab(
  tab: EditorTab,
  patch: { sessionId?: string; title?: string; pid?: number }
): boolean {
  if (!isTerminalTab(tab)) return true
  if (patch.sessionId !== undefined && patch.sessionId !== tab.sessionId) return true
  if (patch.title !== undefined && patch.title !== tab.title) return true
  if (patch.pid !== undefined && patch.pid !== tab.pid) return true
  return false
}

/**
 * Mirror a file/folder rename into every *background* space's stashed snapshot:
 * rewrite the path + title of any fileEditor tab pointing at the renamed file
 * (or, for a folder rename, its descendants). The active workspace is handled by
 * the terminal store (fileExplorerStore.syncTabsOnRename) and skipped here.
 *
 * Without this a background space keeps the pre-rename path: on resume the file
 * reads as "missing", and saving a stashed unsaved (parked) buffer would write
 * to — and so recreate — the old file. Deletes are intentionally NOT mirrored:
 * a background tab for a deleted file surfaces the same graceful "file missing"
 * state the active path already leaves dirty/parked tabs in, with no data loss.
 */
export function syncBackgroundEditorTabsOnRename(
  root: string,
  fromRel: string,
  toRel: string
): void {
  const fromPrefix = fromRel + '/'
  let changed = false
  useSpaceStore.setState((state) => {
    const spaces = state.spaces.map((s) => {
      if (s.id === state.activeSpaceId) return s
      let touched = false
      const groups = s.workspace.groups.map((g) => {
        let groupTouched = false
        const tabs = g.tabs.map((t) => {
          if (t.kind !== 'fileEditor' || t.rootFs !== root) return t
          if (t.relPath === fromRel) {
            groupTouched = true
            return { ...t, relPath: toRel, title: basenameOf(toRel) }
          }
          if (t.relPath.startsWith(fromPrefix)) {
            const next = toRel + '/' + t.relPath.slice(fromPrefix.length)
            groupTouched = true
            return { ...t, relPath: next, title: basenameOf(next) }
          }
          return t
        })
        if (!groupTouched) return g
        touched = true
        changed = true
        return { ...g, tabs }
      })
      return touched ? { ...s, workspace: { ...s.workspace, groups } } : s
    })
    return changed ? { spaces } : {}
  })
  if (changed) useSpaceStore.getState().persist()
}

/**
 * Whether deleting this space would silently discard unsaved editor edits —
 * either a mounted dirty editor (the active space) or a stashed unsaved buffer
 * left behind when the space was backgrounded. Deleting tears the workspace down
 * without a per-file save prompt, so the delete confirmation surfaces this to
 * warn the user before the irreversible action. AI sessions/terminals are not
 * counted (they hold no unsaved *editor* content — DPlex never touches session
 * content) and are covered by the dialog's standard copy.
 */
export function spaceHasUnsavedEditors(id: string): boolean {
  const state = useSpaceStore.getState()
  const space = state.spaces.find((s) => s.id === id)
  if (!space) return false
  const snap =
    id === state.activeSpaceId ? useTerminalStore.getState().snapshotWorkspace() : space.workspace
  for (const g of snap.groups) {
    for (const t of g.tabs) {
      if (t.kind !== 'fileEditor') continue
      if (isFileEditorDirty(t.id) || hasParkedEditorBuffer(t.id)) return true
    }
  }
  return false
}

function bgTabMatchesSession(
  t: EditorTab,
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): boolean {
  if (!isTerminalTab(t)) return false
  if (t.sessionId === sessionId && (t.providerId === providerId || t.providerId === undefined)) {
    return true
  }
  return resumeCommand !== undefined && t.command === resumeCommand
}

/**
 * Locate the first tab backing an AI session inside a *background* space's
 * stashed snapshot. The active space is skipped — its live tabs are the terminal
 * store's responsibility (sessionTabs searches those first). Returns the owning
 * space plus group/tab ids so the caller can switch to it and focus the tab.
 */
export function findBackgroundSessionTab(
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): { spaceId: string; groupId: string; tabId: string } | null {
  const { spaces, activeSpaceId } = useSpaceStore.getState()
  for (const s of spaces) {
    if (s.id === activeSpaceId) continue
    for (const g of s.workspace.groups) {
      const tab = g.tabs.find((t) => bgTabMatchesSession(t, sessionId, providerId, resumeCommand))
      if (tab) return { spaceId: s.id, groupId: g.id, tabId: tab.id }
    }
  }
  return null
}

/**
 * Close every tab backing an AI session that lives in a *background* space: tear
 * down its terminal/PTY, close the session on disk, drop the tab from the stashed
 * snapshot, and prune the layout. The active space is handled by the terminal
 * store (closeOpenTabsForSession) — this covers the parked spaces so deleting a
 * session from the Sessions list leaves no dangling parked tab. Returns true if
 * anything was closed.
 */
export function closeBackgroundSessionTabs(
  sessionId: string,
  providerId: string,
  resumeCommand?: string
): boolean {
  const { spaces, activeSpaceId } = useSpaceStore.getState()
  const idsToClose = new Set<string>()
  for (const s of spaces) {
    if (s.id === activeSpaceId) continue
    for (const g of s.workspace.groups) {
      for (const t of g.tabs) {
        if (bgTabMatchesSession(t, sessionId, providerId, resumeCommand)) idsToClose.add(t.id)
      }
    }
  }
  if (idsToClose.size === 0) return false

  // Side effects first, so the setState updater below stays pure.
  for (const id of idsToClose) destroyTerminal(id)
  void window.dplex.sessions.close(sessionId, providerId).catch(() => {
    // Provider may fail if the session is already gone — ignore.
  })
  useSessionStore.getState().clearLiveTabTitle(providerId, sessionId)

  useSpaceStore.setState((state) => ({
    spaces: state.spaces.map((s) => {
      if (s.id === state.activeSpaceId) return s
      if (!s.workspace.groups.some((g) => g.tabs.some((t) => idsToClose.has(t.id)))) return s
      const groups = s.workspace.groups
        .map((g) => ({ ...g, tabs: g.tabs.filter((t) => !idsToClose.has(t.id)) }))
        .filter((g) => g.tabs.length > 0)
        .map((g) => ({
          ...g,
          activeTabId: g.tabs.some((t) => t.id === g.activeTabId) ? g.activeTabId : g.tabs[0].id,
          previewTabId:
            g.previewTabId && g.tabs.some((t) => t.id === g.previewTabId)
              ? g.previewTabId
              : undefined
        }))
      if (groups.length === 0) return { ...s, workspace: EMPTY_WORKSPACE }
      const validIds = new Set(groups.map((g) => g.id))
      const layout = pruneLayoutToGroups(s.workspace.layout, validIds) ?? EMPTY_WORKSPACE.layout
      const activeGroupId = validIds.has(s.workspace.activeGroupId ?? '')
        ? s.workspace.activeGroupId
        : groups[0].id
      return { ...s, workspace: { groups, layout, activeGroupId } }
    })
  }))
  useSpaceStore.getState().persist()
  return true
}
