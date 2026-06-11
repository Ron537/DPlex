import { create } from 'zustand'
import { useTerminalStore } from './terminalStore'
import { useProjectStore } from './projectStore'
import { useSettingsStore } from './settingsStore'
import { tabMatchesFocus } from '../utils/tabFocus'

/**
 * Ephemeral per-session UI state for the "focus a project" tab filter.
 *
 * Focus has two rendering styles, chosen by the persisted
 * `settings.focusFilterMode`:
 *   - `'dim'`     — non-matching tabs are de-emphasized but stay visible.
 *   - `'isolate'` — only the focused project's tabs are shown; non-matching
 *                   tabs (and the groups left empty by hiding them) collapse
 *                   out of the rendered view.
 *
 * In both styles the underlying terminal store's tab order, group membership,
 * layout and PTYs are NEVER mutated by focus — isolate is a non-destructive
 * derived view (see `utils/tabFocus.ts`). The ONLY store fields focus touches
 * are the active selection (`activeGroupId` + per-group `activeTabId`), so the
 * user isn't left staring at a now-hidden tab; that selection is fully
 * snapshotted on enable and restored on disable, so toggling focus off
 * restores the exact prior view. PTYs live outside React in
 * `terminalRegistry`, so hidden tabs keep their scrollback and processes.
 *
 * `focusedProjectId` is not persisted: the filter is intentionally a
 * session-scoped lens, so reopening DPlex never starts you inside a filtered
 * view you forgot was on.
 */
interface SelectionRef {
  groupId: string
  tabId: string
}

/**
 * Full active-selection snapshot taken when isolate focus is enabled, so every
 * group's active tab (not just the active group's) can be restored exactly.
 * Isolating may switch the active tab of more than one group when the active
 * group has no matching tab and focus must jump elsewhere.
 */
interface SelectionSnapshot {
  activeGroupId: string | null
  activeTabByGroup: Record<string, string>
}

interface TabFocusState {
  focusedProjectId: string | null
  /**
   * The active group's selection captured the moment isolate focus was turned
   * on. Retained primarily so callers/tests can introspect the restore point;
   * the authoritative restore uses {@link SelectionSnapshot}.
   */
  preIsolateSelection: SelectionRef | null
  /** Full selection snapshot used to restore every group on focus-off. */
  preIsolateSnapshot: SelectionSnapshot | null
  /**
   * Per-project memory of the last tab the user viewed while isolating that
   * project, so re-selecting the project restores its last-active tab.
   */
  isolateSelectionByProject: Record<string, SelectionRef>
  /** Set focus to a specific project. Use `null` to clear. */
  setFocusedProject: (projectId: string | null) => void
  /** Toggle focus on `projectId`: enables it, or clears if already focused on the same project. */
  toggleFocusedProject: (projectId: string) => void
  clear: () => void
  /** @internal — capture the pre-isolate restore point (active ref + full snapshot). */
  _capturePreIsolate: (ref: SelectionRef | null, snapshot: SelectionSnapshot) => void
  /** @internal — remember a project's active tab while isolating. */
  _rememberIsolateSelection: (projectId: string, sel: SelectionRef) => void
}

export const useTabFocusStore = create<TabFocusState>((set, get) => ({
  focusedProjectId: null,
  preIsolateSelection: null,
  preIsolateSnapshot: null,
  isolateSelectionByProject: {},
  setFocusedProject: (projectId) => set({ focusedProjectId: projectId }),
  toggleFocusedProject: (projectId) => {
    const current = get().focusedProjectId
    set({ focusedProjectId: current === projectId ? null : projectId })
  },
  clear: () => set({ focusedProjectId: null, preIsolateSelection: null, preIsolateSnapshot: null }),
  _capturePreIsolate: (ref, snapshot) =>
    set({ preIsolateSelection: ref, preIsolateSnapshot: snapshot }),
  _rememberIsolateSelection: (projectId, sel) =>
    set((state) => ({
      isolateSelectionByProject: { ...state.isolateSelectionByProject, [projectId]: sel }
    }))
}))

// ---------------------------------------------------------------------------
// Cross-store focus controller
//
// These helpers orchestrate the focus toggle across the terminal, project and
// settings stores. They live here (not as store actions) because they read and
// drive other stores, mirroring the pattern used by `utils/sessionTabs.ts`.
// Stores are referenced only via `getState()` inside functions to keep the
// module-load cycle with `projectStore` safe.
// ---------------------------------------------------------------------------

function isIsolateMode(): boolean {
  return useSettingsStore.getState().settings.focusFilterMode === 'isolate'
}

/**
 * Resolve a project id to its "color" (family) project — the parent project
 * for worktrees, otherwise itself. Focus always targets the family so the main
 * repo and all its worktree tabs are shown together, matching the visual
 * grouping in `getTabIdentity` and the dim-focus behavior.
 */
function colorProjectIdOf(projectId: string | null): string | null {
  if (!projectId) return null
  const proj = useProjectStore.getState().projects.find((p) => p.id === projectId)
  return proj?.parentProjectId ?? projectId
}

/** The active selection ({groupId, tabId}) from the terminal store, if any. */
function currentSelection(): SelectionRef | null {
  const ts = useTerminalStore.getState()
  if (!ts.activeGroupId) return null
  const group = ts.groups.find((g) => g.id === ts.activeGroupId)
  if (!group) return null
  return { groupId: group.id, tabId: group.activeTabId }
}

/** Capture every group's active tab plus the active group, for exact restore. */
function fullSelectionSnapshot(): SelectionSnapshot {
  const ts = useTerminalStore.getState()
  const activeTabByGroup: Record<string, string> = {}
  for (const g of ts.groups) activeTabByGroup[g.id] = g.activeTabId
  return { activeGroupId: ts.activeGroupId, activeTabByGroup }
}

/**
 * Restore a previously captured selection snapshot. Per-group active tabs are
 * restored first (each `setActiveTerminalInGroup` also sets `activeGroupId` as
 * a side effect), then the real active group is restored last. Only touches
 * groups/tabs that still exist.
 */
function restoreSelectionSnapshot(snapshot: SelectionSnapshot): void {
  const ts = useTerminalStore.getState()
  for (const [groupId, tabId] of Object.entries(snapshot.activeTabByGroup)) {
    const group = ts.groups.find((g) => g.id === groupId)
    if (group && group.activeTabId !== tabId && group.tabs.some((t) => t.id === tabId)) {
      ts.setActiveTerminalInGroup(groupId, tabId)
    }
  }
  if (snapshot.activeGroupId && ts.groups.some((g) => g.id === snapshot.activeGroupId)) {
    ts.setActiveGroup(snapshot.activeGroupId)
  }
}

/**
 * Resolve the project to focus: the family (color) project of the active
 * project. Returns `null` when no project is active (nothing to focus). The
 * active project is kept in sync with the active tab by `projectStore`, so this
 * tracks "what the user is looking at" without a separate tab fallback.
 */
export function resolveFocusTarget(): string | null {
  return colorProjectIdOf(useProjectStore.getState().activeProjectId)
}

/**
 * Switch the active selection to the focused project's tab when isolating, so
 * the user is never left on a hidden tab. Selection priority:
 *   1. If the current active tab already matches, do nothing — this preserves
 *      explicit navigation (e.g. opening a session via the command palette).
 *   2. The project's remembered selection, if it still exists and matches.
 *   3. A matching tab within the currently active group (avoids a group jump).
 *   4. The first matching tab in any group.
 * Only ever changes which tab/group is active — never moves or destroys tabs.
 */
function applyIsolateSelection(projectId: string): void {
  const ts = useTerminalStore.getState()
  const projects = useProjectStore.getState().projects
  const activeGroup = ts.groups.find((g) => g.id === ts.activeGroupId)
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  if (activeTab && tabMatchesFocus(activeTab, projects, projectId)) return

  const remembered = useTabFocusStore.getState().isolateSelectionByProject[projectId]
  if (remembered) {
    const group = ts.groups.find((g) => g.id === remembered.groupId)
    const tab = group?.tabs.find((t) => t.id === remembered.tabId)
    if (group && tab && tabMatchesFocus(tab, projects, projectId)) {
      ts.setActiveGroup(group.id)
      ts.setActiveTerminalInGroup(group.id, tab.id)
      return
    }
  }

  if (activeGroup) {
    const tab = activeGroup.tabs.find((t) => tabMatchesFocus(t, projects, projectId))
    if (tab) {
      ts.setActiveGroup(activeGroup.id)
      ts.setActiveTerminalInGroup(activeGroup.id, tab.id)
      return
    }
  }

  for (const group of ts.groups) {
    const tab = group.tabs.find((t) => tabMatchesFocus(t, projects, projectId))
    if (tab) {
      ts.setActiveGroup(group.id)
      ts.setActiveTerminalInGroup(group.id, tab.id)
      return
    }
  }
}

/** Turn focus on, targeting the active project's family. */
export function enableFocus(): void {
  const target = resolveFocusTarget()
  if (!target) return
  const store = useTabFocusStore.getState()
  if (isIsolateMode()) {
    store._capturePreIsolate(currentSelection(), fullSelectionSnapshot())
  }
  store.setFocusedProject(target)
  if (isIsolateMode()) applyIsolateSelection(target)
}

/** Turn focus off, restoring the pre-isolate selection when one was captured. */
export function disableFocus(): void {
  const store = useTabFocusStore.getState()
  const snapshot = store.preIsolateSnapshot
  store.clear()
  // Restore whenever a snapshot exists — it is only ever captured while
  // isolating, so the current dim/isolate setting is irrelevant here (the user
  // may have flipped the style mid-focus).
  if (snapshot) restoreSelectionSnapshot(snapshot)
}

/** Quick toggle used by the prominent focus control and its shortcut. */
export function toggleFocus(): void {
  if (useTabFocusStore.getState().focusedProjectId !== null) disableFocus()
  else enableFocus()
}

let focusControllerWired = false

/**
 * Wire the focus controller's cross-store subscriptions exactly once:
 *   1. Follow the active project — while isolate focus is on, switching to a
 *      different project *family* re-targets the filter and re-selects that
 *      project's tab. Switching within the same family (repo ↔ worktree, or
 *      between sibling worktrees) keeps focus, so it never silently narrows.
 *   2. Remember per-project selection — while isolating, record the active tab
 *      for the focused project so re-selecting it restores that tab.
 *   3. Re-apply selection when the dim/isolate setting flips while focus is on.
 */
export function wireFocusController(): () => void {
  if (focusControllerWired) return () => undefined
  focusControllerWired = true

  const unsubProject = useProjectStore.subscribe((state, prev) => {
    if (state.activeProjectId === prev.activeProjectId) return
    const focus = useTabFocusStore.getState()
    if (focus.focusedProjectId === null || !isIsolateMode()) return
    // Retarget only when the active project's *family* changes.
    const newColor = colorProjectIdOf(state.activeProjectId)
    if (newColor === focus.focusedProjectId) return
    if (newColor === null) {
      // No active project left to follow (e.g. all project tabs closed). Tear
      // focus down via disableFocus so the pre-isolate snapshot is restored and
      // cleared — `setFocusedProject(null)` alone would leave a stale snapshot
      // that a later enable could wrongly restore.
      disableFocus()
      return
    }
    focus.setFocusedProject(newColor)
    // `applyIsolateSelection` early-returns when the active tab already matches
    // the new target, so explicit navigation (palette/search to a specific
    // tab) is preserved rather than overridden by a remembered selection.
    applyIsolateSelection(newColor)
  })

  let prevTabKey: string | null = (() => {
    const sel = currentSelection()
    return sel ? `${sel.groupId}::${sel.tabId}` : null
  })()
  const unsubTerminal = useTerminalStore.subscribe((state) => {
    const group = state.groups.find((g) => g.id === state.activeGroupId)
    const key = group ? `${group.id}::${group.activeTabId}` : null
    if (key === prevTabKey) return
    prevTabKey = key
    const focus = useTabFocusStore.getState()
    if (focus.focusedProjectId === null || !isIsolateMode() || !group) return
    focus._rememberIsolateSelection(focus.focusedProjectId, {
      groupId: group.id,
      tabId: group.activeTabId
    })
  })

  const unsubSettings = useSettingsStore.subscribe((state, prev) => {
    if (state.settings.focusFilterMode === prev.settings.focusFilterMode) return
    const focus = useTabFocusStore.getState()
    if (focus.focusedProjectId === null) return
    if (state.settings.focusFilterMode === 'isolate') {
      // Entering isolate mid-focus: capture the restore point only if one isn't
      // already held, so the earliest pre-isolate selection survives a
      // dim → isolate → dim → isolate flip and is restored on focus-off.
      if (focus.preIsolateSnapshot === null) {
        focus._capturePreIsolate(currentSelection(), fullSelectionSnapshot())
      }
      applyIsolateSelection(focus.focusedProjectId)
    }
  })

  return () => {
    unsubProject()
    unsubTerminal()
    unsubSettings()
    focusControllerWired = false
  }
}
