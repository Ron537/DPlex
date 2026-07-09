import { create } from 'zustand'
import type {
  TerminalTab,
  FileDiffTab,
  FileEditorTab,
  DashboardTab,
  EditorTab,
  EditorGroup,
  LayoutNode
} from '../types'
import { isFileDiffTab, isFileEditorTab, isTerminalTab, isDashboardTab } from '../types'
import { destroyTerminal } from '../services/terminalRegistry'
import { useSessionStore } from './sessionStore'

let tabCounter = 0
let groupCounter = 0

function makeTerminalId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function makeGroupId(): string {
  return `group-${++groupCounter}`
}

function makeTerminalTab(
  title?: string,
  id?: string,
  shell?: string,
  cwd?: string,
  command?: string,
  providerId?: string
): TerminalTab {
  tabCounter++
  return {
    id: id ?? makeTerminalId(),
    title: title ?? `Terminal ${tabCounter}`,
    shell,
    cwd,
    command,
    providerId
  }
}

/** Default title for a fileDiff tab — basename of the gitPath. */
function makeFileDiffTitle(gitPath: string): string {
  const i = gitPath.lastIndexOf('/')
  return i >= 0 ? gitPath.slice(i + 1) : gitPath
}

/**
 * Whether two diff scopes refer to the same comparison. Used to decide
 * whether an open diff tab can be reused/focused. Beyond `kind`, commit and
 * branch scopes must match their discriminant (SHA / base) so e.g. the same
 * file viewed at two different commits opens two distinct tabs.
 */
function scopesMatch(a: FileDiffTab['scope'], b: FileDiffTab['scope']): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'commit' && b.kind === 'commit') return a.sha === b.sha
  if (a.kind === 'branch' && b.kind === 'branch') return a.base === b.base
  return true
}

/** Basename of a project-relative POSIX path (file editor tab title). */
function makeFileTitle(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(i + 1) : relPath
}

/**
 * Clear the `preview` flag on a preview tab being moved between groups.
 * Works for any previewable tab kind (fileDiff / fileEditor).
 */
function promoteOnMove(tab: EditorTab): EditorTab {
  if (isFileDiffTab(tab)) return { ...tab, preview: false }
  if (isFileEditorTab(tab)) return { ...tab, preview: false }
  return tab
}

function removeGroupFromLayout(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === 'group') {
    return node.groupId === groupId ? null : node
  }
  if (!node.children) return node
  const filtered = node.children
    .map((child) => removeGroupFromLayout(child, groupId))
    .filter(Boolean) as LayoutNode[]
  if (filtered.length === 0) return null
  if (filtered.length === 1) return filtered[0]
  return { ...node, children: filtered }
}

function insertSplitInLayout(
  node: LayoutNode,
  targetGroupId: string,
  newGroupId: string,
  direction: 'horizontal' | 'vertical'
): LayoutNode {
  if (node.type === 'group' && node.groupId === targetGroupId) {
    return {
      type: 'split',
      direction,
      children: [node, { type: 'group', groupId: newGroupId }]
    }
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) =>
        insertSplitInLayout(child, targetGroupId, newGroupId, direction)
      )
    }
  }
  return node
}

interface TerminalState {
  groups: EditorGroup[]
  layout: LayoutNode
  activeGroupId: string | null
  restored: boolean

  createTerminal: (
    groupId?: string,
    title?: string,
    command?: string,
    shell?: string,
    cwd?: string,
    providerId?: string
  ) => string
  closeTerminal: (terminalId: string) => void
  setActiveGroup: (groupId: string) => void
  setActiveTerminalInGroup: (groupId: string, terminalId: string) => void
  renameTerminal: (terminalId: string, title: string) => void
  /** Set (hex string) or clear (null) a tab's user-chosen color. Applies to
   *  any tab kind; the choice is persisted with the workspace. */
  setTabColor: (tabId: string, color: string | null) => void
  splitGroup: (groupId: string, direction: 'horizontal' | 'vertical', cwd?: string) => string
  moveTerminalToGroup: (terminalId: string, targetGroupId: string, insertIndex?: number) => void
  moveTerminalToNewSplit: (
    terminalId: string,
    targetGroupId: string,
    direction: 'horizontal' | 'vertical',
    position: 'before' | 'after'
  ) => void
  reorderTab: (groupId: string, fromIndex: number, toIndex: number) => void
  getActiveGroup: () => EditorGroup | undefined
  getAllTerminalIds: () => string[]
  restoreWorkspace: (
    groups: EditorGroup[],
    layout: LayoutNode,
    activeGroupId: string | null
  ) => void
  setPid: (terminalId: string, pid: number) => void
  associateSessionId: (terminalId: string, sessionId: string) => void
  setWorktreeMetadata: (
    terminalId: string,
    worktreePath: string,
    worktreeBranch: string | null
  ) => void
  openOrFocusDiffTab: (input: {
    repoRootFs: string
    repoLabel: string
    scope: FileDiffTab['scope']
    title?: string
    /** Tab to spawn for. Required — repo-level diff dashboards no longer exist. */
    file: FileDiffTab['file']
    /** When true, opened as a preview tab (italic, single slot per group,
     *  replaceable on next openOrFocus). Defaults to false (permanent). */
    preview?: boolean
  }) => string
  /**
   * Promote the named tab from preview → permanent within its group.
   * No-op when the tab isn't currently the group's preview.
   */
  promotePreviewTab: (tabId: string) => void
  updateFileDiffTab: (tabId: string, patch: Partial<Omit<FileDiffTab, 'id' | 'kind'>>) => void
  /**
   * Open (or focus) an editable file tab from the explorer. Mirrors
   * `openOrFocusDiffTab` preview/promote/focus semantics but for the
   * `fileEditor` tab kind. Matching identity is (rootFs, relPath).
   */
  openOrFocusFileTab: (input: {
    rootFs: string
    rootLabel: string
    relPath: string
    title?: string
    /** When true, opened as a preview tab (italic, single slot per group). */
    preview?: boolean
  }) => string
  updateFileEditorTab: (tabId: string, patch: Partial<Omit<FileEditorTab, 'id' | 'kind'>>) => void
  /**
   * Open the singleton Overview Dashboard tab, or focus it if already open.
   * Returns the dashboard tab id.
   */
  openOrFocusDashboardTab: () => string
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  groups: [],
  layout: { type: 'group', groupId: 'group-0' },
  activeGroupId: null,
  restored: false,
  createTerminal: (
    groupId?: string,
    title?: string,
    command?: string,
    shell?: string,
    cwd?: string,
    providerId?: string
  ) => {
    const state = get()
    const tab = makeTerminalTab(title, undefined, shell, cwd, command, providerId)
    const targetGroupId = groupId ?? state.activeGroupId

    // If no groups exist or target group not found, create initial group
    if (state.groups.length === 0 || !targetGroupId) {
      const newGroup: EditorGroup = {
        id: 'group-0',
        tabs: [tab],
        activeTabId: tab.id
      }
      set({
        groups: [newGroup],
        layout: { type: 'group', groupId: newGroup.id },
        activeGroupId: newGroup.id
      })
      return tab.id
    }

    const targetGroup = state.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) {
      // Create terminal in a new group
      const gid = makeGroupId()
      const newGroup: EditorGroup = { id: gid, tabs: [tab], activeTabId: tab.id }
      set({
        groups: [...state.groups, newGroup],
        layout: insertSplitInLayout(state.layout, state.activeGroupId!, gid, 'horizontal'),
        activeGroupId: gid
      })
      return tab.id
    }

    set({
      groups: state.groups.map((g) =>
        g.id === targetGroupId ? { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id } : g
      ),
      activeGroupId: targetGroupId
    })
    return tab.id
  },

  closeTerminal: (terminalId) => {
    const state = get()

    // If this tab is tied to an AI session, explicitly close the session on
    // disk (kills PIDs in inuse.*.lock files via the provider's canonical
    // path). Just killing the PTY sometimes leaves the Copilot process alive
    // (SIGHUP may not propagate or may be caught), so the session keeps
    // showing as active in history/project views until a manual close.
    let tab: EditorTab | undefined
    for (const g of state.groups) {
      const found = g.tabs.find((t) => t.id === terminalId)
      if (found) {
        tab = found
        break
      }
    }
    if (tab && isTerminalTab(tab) && tab.sessionId && tab.providerId) {
      void window.dplex.sessions.close(tab.sessionId, tab.providerId).catch(() => {
        // ignore — provider may fail if the session is already gone
      })
      // Drop the live OSC-title override so future provider updates can win
      // again. The current sessions[].displayName keeps the last OSC title
      // until the provider's onUpdated callback re-derives it (which happens
      // shortly after closeSession kills the lock file).
      useSessionStore.getState().clearLiveTabTitle(tab.providerId, tab.sessionId)
    }

    destroyTerminal(terminalId)

    const updatedGroups = state.groups.map((g) => {
      const idx = g.tabs.findIndex((t) => t.id === terminalId)
      if (idx === -1) return g
      const newTabs = g.tabs.filter((t) => t.id !== terminalId)
      const newActive =
        g.activeTabId === terminalId ? (newTabs[Math.max(0, idx - 1)]?.id ?? null) : g.activeTabId
      return {
        ...g,
        tabs: newTabs,
        activeTabId: newActive ?? '',
        // Invariant: previewTabId must be undefined or refer to an existing
        // tab in `tabs`. If we removed the preview tab, clear the slot.
        previewTabId: g.previewTabId === terminalId ? undefined : g.previewTabId
      }
    })

    // Remove empty groups
    const emptyGroupIds = updatedGroups.filter((g) => g.tabs.length === 0).map((g) => g.id)
    const aliveGroups = updatedGroups.filter((g) => g.tabs.length > 0)

    let newLayout = state.layout
    for (const gid of emptyGroupIds) {
      const pruned = removeGroupFromLayout(newLayout, gid)
      if (pruned) newLayout = pruned
    }

    const newActiveGroupId =
      aliveGroups.find((g) => g.id === state.activeGroupId)?.id ?? aliveGroups[0]?.id ?? null

    set({
      groups: aliveGroups,
      layout: aliveGroups.length > 0 ? newLayout : { type: 'group', groupId: 'group-0' },
      activeGroupId: newActiveGroupId
    })
  },

  setActiveGroup: (groupId) => {
    set({ activeGroupId: groupId })
  },

  setActiveTerminalInGroup: (groupId, terminalId) => {
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, activeTabId: terminalId } : g)),
      activeGroupId: groupId
    }))
  },

  renameTerminal: (terminalId, title) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === terminalId ? { ...t, title } : t))
      }))
    }))
  },

  setTabColor: (tabId, color) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        // `color ?? undefined` clears the key when passed null; JSON.stringify
        // drops undefined so cleared tabs don't carry an empty `color` field.
        tabs: g.tabs.map((t) =>
          t.id === tabId ? ({ ...t, color: color ?? undefined } as EditorTab) : t
        )
      }))
    }))
  },

  splitGroup: (groupId, direction, cwd) => {
    const state = get()

    // cwd inheritance resolves asynchronously before splitGroup is called, so
    // the target group may have been closed in the meantime. Splitting against
    // a group that's no longer in the layout would append an orphan group that
    // insertSplitInLayout can't attach, leaving it unreachable. Redirect to the
    // active group, or open a standalone terminal if nothing valid remains.
    const targetGroupId = state.groups.some((g) => g.id === groupId)
      ? groupId
      : state.activeGroupId && state.groups.some((g) => g.id === state.activeGroupId)
        ? state.activeGroupId
        : null
    if (!targetGroupId) {
      return get().createTerminal(undefined, undefined, undefined, undefined, cwd)
    }

    const newGid = makeGroupId()
    const tab = makeTerminalTab(undefined, undefined, undefined, cwd)
    const newGroup: EditorGroup = { id: newGid, tabs: [tab], activeTabId: tab.id }

    set({
      groups: [...state.groups, newGroup],
      layout: insertSplitInLayout(state.layout, targetGroupId, newGid, direction),
      activeGroupId: newGid
    })
    return tab.id
  },

  moveTerminalToGroup: (terminalId, targetGroupId, insertIndex) => {
    const state = get()

    // Find source group and tab
    const sourceGroup = state.groups.find((g) => g.tabs.some((t) => t.id === terminalId))
    if (!sourceGroup) return
    const tab = sourceGroup.tabs.find((t) => t.id === terminalId)!

    // Don't move to same group (unless reordering — handled by reorderTab)
    if (sourceGroup.id === targetGroupId && insertIndex === undefined) return

    // Moving a tab between groups always promotes it out of preview state —
    // the source group's preview slot is cleared if the moved tab held it,
    // and the target group's preview slot is NOT inherited.
    const wasPreviewInSource = sourceGroup.previewTabId === terminalId
    const movedTab = wasPreviewInSource ? promoteOnMove(tab) : tab

    // Remove from source
    const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== terminalId)
    const newSourceActive =
      sourceGroup.activeTabId === terminalId
        ? (newSourceTabs[0]?.id ?? '')
        : sourceGroup.activeTabId

    let updatedGroups = state.groups.map((g) => {
      if (g.id === sourceGroup.id) {
        return {
          ...g,
          tabs: newSourceTabs,
          activeTabId: newSourceActive,
          previewTabId: wasPreviewInSource ? undefined : g.previewTabId
        }
      }
      if (g.id === targetGroupId) {
        const newTabs = [...g.tabs]
        if (insertIndex !== undefined) {
          newTabs.splice(insertIndex, 0, movedTab)
        } else {
          newTabs.push(movedTab)
        }
        return { ...g, tabs: newTabs, activeTabId: movedTab.id }
      }
      return g
    })

    // Remove empty groups
    const emptyIds = updatedGroups.filter((g) => g.tabs.length === 0).map((g) => g.id)
    updatedGroups = updatedGroups.filter((g) => g.tabs.length > 0)

    let newLayout = state.layout
    for (const gid of emptyIds) {
      const pruned = removeGroupFromLayout(newLayout, gid)
      if (pruned) newLayout = pruned
    }

    set({
      groups: updatedGroups,
      layout: updatedGroups.length > 0 ? newLayout : state.layout,
      activeGroupId: targetGroupId
    })
  },

  moveTerminalToNewSplit: (terminalId, targetGroupId, direction, position) => {
    const state = get()
    const sourceGroup = state.groups.find((g) => g.tabs.some((t) => t.id === terminalId))
    if (!sourceGroup) return
    const tab = sourceGroup.tabs.find((t) => t.id === terminalId)!

    // Promote out of preview when moving — see moveTerminalToGroup.
    const wasPreviewInSource = sourceGroup.previewTabId === terminalId
    const movedTab = wasPreviewInSource ? promoteOnMove(tab) : tab

    // Create new group with this tab
    const newGid = makeGroupId()
    const newGroup: EditorGroup = { id: newGid, tabs: [movedTab], activeTabId: movedTab.id }

    // Remove from source
    const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== terminalId)
    const newSourceActive =
      sourceGroup.activeTabId === terminalId
        ? (newSourceTabs[0]?.id ?? '')
        : sourceGroup.activeTabId

    let updatedGroups = state.groups.map((g) =>
      g.id === sourceGroup.id
        ? {
            ...g,
            tabs: newSourceTabs,
            activeTabId: newSourceActive,
            previewTabId: wasPreviewInSource ? undefined : g.previewTabId
          }
        : g
    )
    updatedGroups = [...updatedGroups.filter((g) => g.tabs.length > 0), newGroup]

    // Remove empty groups from layout first
    let newLayout = state.layout
    const emptyIds = state.groups
      .map((g) => (g.id === sourceGroup.id && newSourceTabs.length === 0 ? g.id : null))
      .filter(Boolean) as string[]
    for (const gid of emptyIds) {
      const pruned = removeGroupFromLayout(newLayout, gid)
      if (pruned) newLayout = pruned
    }

    // Insert new group as a split relative to target
    newLayout = insertSplitAtPosition(newLayout, targetGroupId, newGid, direction, position)

    set({
      groups: updatedGroups,
      layout: newLayout,
      activeGroupId: newGid
    })
  },

  reorderTab: (groupId, fromIndex, toIndex) => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id !== groupId) return g
        const tabs = [...g.tabs]
        const [moved] = tabs.splice(fromIndex, 1)
        tabs.splice(toIndex, 0, moved)
        return { ...g, tabs }
      })
    }))
  },

  getActiveGroup: () => {
    const state = get()
    return state.groups.find((g) => g.id === state.activeGroupId)
  },

  getAllTerminalIds: () => {
    return get().groups.flatMap((g) => g.tabs.map((t) => t.id))
  },

  restoreWorkspace: (groups, layout, activeGroupId) => {
    // Don't overwrite if terminals were already created during async load
    if (get().groups.length > 0) return
    // Sync counters so new tabs/groups don't collide with restored IDs
    for (const g of groups) {
      const num = parseInt(g.id.replace('group-', ''), 10)
      if (!isNaN(num) && num >= groupCounter) groupCounter = num + 1
    }
    // Sanitize the previewTabId invariant: must be undefined or refer to an
    // existing tab in `tabs`. Older serialized workspaces lack the field
    // entirely (undefined is fine); newer ones may persist a value pointing
    // to a tab we deliberately filtered out (preview tabs aren't persisted),
    // so re-validate.
    const sanitized = groups.map((g) => ({
      ...g,
      previewTabId:
        g.previewTabId && g.tabs.some((t) => t.id === g.previewTabId) ? g.previewTabId : undefined
    }))
    set({ groups: sanitized, layout, activeGroupId, restored: true })
  },

  setPid: (terminalId, pid) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === terminalId ? { ...t, pid } : t))
      }))
    }))
  },

  associateSessionId: (terminalId, sessionId) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === terminalId ? { ...t, sessionId } : t))
      }))
    }))
  },

  setWorktreeMetadata: (terminalId, worktreePath, worktreeBranch) => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) =>
          t.id === terminalId && isTerminalTab(t)
            ? { ...t, worktreePath, worktreeBranch: worktreeBranch ?? undefined }
            : t
        )
      }))
    }))
  },

  openOrFocusDiffTab: (input): string => {
    const state = get()

    // Preview-tab semantics: if the active group already has a preview tab,
    // we MUTATE its bound file/title in place (single slot per group). This
    // mirrors VS Code: clicking a second file replaces the previewed file
    // rather than spawning a sibling tab.
    if (input.preview === true) {
      const targetGroupId = state.activeGroupId
      const targetGroup = state.groups.find((g) => g.id === targetGroupId)
      if (targetGroup && targetGroup.previewTabId) {
        const previewTab = targetGroup.tabs.find((t) => t.id === targetGroup.previewTabId)
        if (previewTab && isFileDiffTab(previewTab)) {
          const replacement: FileDiffTab = {
            ...previewTab,
            repoRootFs: input.repoRootFs,
            repoLabel: input.repoLabel,
            scope: input.scope,
            file: input.file,
            title: input.title ?? makeFileDiffTitle(input.file.gitPath),
            preview: true
          }
          set({
            activeGroupId: targetGroup.id,
            groups: state.groups.map((g) =>
              g.id === targetGroup.id
                ? {
                    ...g,
                    tabs: g.tabs.map((t) => (t.id === replacement.id ? replacement : t)),
                    activeTabId: replacement.id
                  }
                : g
            )
          })
          return replacement.id
        }
      }
    }

    // No preview slot to reuse — focus an existing PERMANENT tab for the
    // same (repoRootFs, scope.kind, gitPath); only fall through to creating
    // a new tab when no match exists. If a PREVIEW tab already exists for the
    // same file and we're being asked to open it permanently (preview=false),
    // promote it in place rather than spawning a duplicate.
    for (const g of state.groups) {
      for (const t of g.tabs) {
        if (
          isFileDiffTab(t) &&
          t.repoRootFs === input.repoRootFs &&
          scopesMatch(t.scope, input.scope) &&
          t.file.gitPath === input.file.gitPath
        ) {
          if (t.preview && input.preview === false) {
            const promoted: FileDiffTab = { ...t, preview: false }
            set({
              activeGroupId: g.id,
              groups: state.groups.map((gg) =>
                gg.id === g.id
                  ? {
                      ...gg,
                      tabs: gg.tabs.map((tt) => (tt.id === t.id ? promoted : tt)),
                      activeTabId: t.id,
                      previewTabId: gg.previewTabId === t.id ? undefined : gg.previewTabId
                    }
                  : gg
              )
            })
            return t.id
          }
          if (!t.preview) {
            set({
              activeGroupId: g.id,
              groups: state.groups.map((gg) => (gg.id === g.id ? { ...gg, activeTabId: t.id } : gg))
            })
            return t.id
          }
        }
      }
    }

    const tab: FileDiffTab = {
      id: makeTerminalId(),
      title: input.title ?? makeFileDiffTitle(input.file.gitPath),
      kind: 'fileDiff',
      repoRootFs: input.repoRootFs,
      repoLabel: input.repoLabel,
      scope: input.scope,
      file: input.file,
      preview: input.preview === true
    }
    const targetGroupId = state.activeGroupId
    if (state.groups.length === 0 || !targetGroupId) {
      const newGroup: EditorGroup = {
        id: 'group-0',
        tabs: [tab],
        activeTabId: tab.id,
        previewTabId: tab.preview ? tab.id : undefined
      }
      set({
        groups: [newGroup],
        layout: { type: 'group', groupId: newGroup.id },
        activeGroupId: newGroup.id
      })
      return tab.id
    }
    const targetGroup = state.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) {
      const gid = makeGroupId()
      const newGroup: EditorGroup = {
        id: gid,
        tabs: [tab],
        activeTabId: tab.id,
        previewTabId: tab.preview ? tab.id : undefined
      }
      set({
        groups: [...state.groups, newGroup],
        activeGroupId: gid
      })
      return tab.id
    }
    set({
      groups: state.groups.map((g) =>
        g.id === targetGroupId
          ? {
              ...g,
              tabs: [...g.tabs, tab],
              activeTabId: tab.id,
              // New preview tab claims the slot, evicting any previous preview
              // metadata (which should not happen — would mean the existing
              // preview tab survived the replace branch above).
              previewTabId: tab.preview ? tab.id : g.previewTabId
            }
          : g
      ),
      activeGroupId: targetGroupId
    })
    return tab.id
  },

  promotePreviewTab: (tabId: string): void => {
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.previewTabId !== tabId) return g
        return {
          ...g,
          previewTabId: undefined,
          tabs: g.tabs.map((t) =>
            t.id === tabId && (isFileDiffTab(t) || isFileEditorTab(t))
              ? { ...t, preview: false }
              : t
          )
        }
      })
    }))
  },

  updateFileDiffTab: (tabId: string, patch: Partial<Omit<FileDiffTab, 'id' | 'kind'>>): void => {
    set((state) => ({
      groups: state.groups.map((g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === tabId && isFileDiffTab(t) ? { ...t, ...patch } : t))
      }))
    }))
  },

  openOrFocusFileTab: (input): string => {
    const state = get()

    // Focus an existing tab for the same (rootFs, relPath) FIRST — before any
    // preview-slot reuse — so single-clicking a file that's already open
    // (anywhere, even as a permanent tab in another group) focuses it instead
    // of duplicating it into the active group's preview slot. Promote a preview
    // match to permanent when opened with preview=false (double-click).
    for (const g of state.groups) {
      for (const t of g.tabs) {
        if (isFileEditorTab(t) && t.rootFs === input.rootFs && t.relPath === input.relPath) {
          if (t.preview && input.preview === false) {
            const promoted: FileEditorTab = { ...t, preview: false }
            set({
              activeGroupId: g.id,
              groups: state.groups.map((gg) =>
                gg.id === g.id
                  ? {
                      ...gg,
                      tabs: gg.tabs.map((tt) => (tt.id === t.id ? promoted : tt)),
                      activeTabId: t.id,
                      previewTabId: gg.previewTabId === t.id ? undefined : gg.previewTabId
                    }
                  : gg
              )
            })
            return t.id
          }
          set({
            activeGroupId: g.id,
            groups: state.groups.map((gg) => (gg.id === g.id ? { ...gg, activeTabId: t.id } : gg))
          })
          return t.id
        }
      }
    }

    // Preview-tab semantics: reuse the active group's preview slot in place,
    // BUT never silently replace a dirty preview (would discard edits). When
    // the current preview file editor is dirty, fall through to create/focus
    // a separate tab instead.
    if (input.preview === true) {
      const targetGroup = state.groups.find((g) => g.id === state.activeGroupId)
      if (targetGroup && targetGroup.previewTabId) {
        const previewTab = targetGroup.tabs.find((t) => t.id === targetGroup.previewTabId)
        if (previewTab && isFileEditorTab(previewTab) && previewTab.dirty !== true) {
          const replacement: FileEditorTab = {
            ...previewTab,
            rootFs: input.rootFs,
            rootLabel: input.rootLabel,
            relPath: input.relPath,
            title: input.title ?? makeFileTitle(input.relPath),
            preview: true,
            dirty: false
          }
          set({
            activeGroupId: targetGroup.id,
            groups: state.groups.map((g) =>
              g.id === targetGroup.id
                ? {
                    ...g,
                    tabs: g.tabs.map((t) => (t.id === replacement.id ? replacement : t)),
                    activeTabId: replacement.id
                  }
                : g
            )
          })
          return replacement.id
        }
      }
    }

    const tab: FileEditorTab = {
      id: makeTerminalId(),
      title: input.title ?? makeFileTitle(input.relPath),
      kind: 'fileEditor',
      rootFs: input.rootFs,
      rootLabel: input.rootLabel,
      relPath: input.relPath,
      preview: input.preview === true
    }
    const targetGroupId = state.activeGroupId
    if (state.groups.length === 0 || !targetGroupId) {
      const newGroup: EditorGroup = {
        id: 'group-0',
        tabs: [tab],
        activeTabId: tab.id,
        previewTabId: tab.preview ? tab.id : undefined
      }
      set({
        groups: [newGroup],
        layout: { type: 'group', groupId: newGroup.id },
        activeGroupId: newGroup.id
      })
      return tab.id
    }
    const targetGroup = state.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) {
      const gid = makeGroupId()
      const newGroup: EditorGroup = {
        id: gid,
        tabs: [tab],
        activeTabId: tab.id,
        previewTabId: tab.preview ? tab.id : undefined
      }
      set({ groups: [...state.groups, newGroup], activeGroupId: gid })
      return tab.id
    }
    set({
      groups: state.groups.map((g) =>
        g.id === targetGroupId
          ? {
              ...g,
              tabs: [...g.tabs, tab],
              activeTabId: tab.id,
              previewTabId: tab.preview ? tab.id : g.previewTabId
            }
          : g
      ),
      activeGroupId: targetGroupId
    })
    return tab.id
  },

  updateFileEditorTab: (
    tabId: string,
    patch: Partial<Omit<FileEditorTab, 'id' | 'kind'>>
  ): void => {
    set((state) => ({
      groups: state.groups.map((g) => {
        let promotedOut = false
        const tabs = g.tabs.map((t) => {
          if (t.id !== tabId || !isFileEditorTab(t)) return t
          const next = { ...t, ...patch }
          // A preview tab that just became dirty is promoted to permanent so
          // a subsequent single-click can't replace (and discard) it.
          if (next.dirty === true && g.previewTabId === t.id) {
            next.preview = false
            promotedOut = true
          }
          return next
        })
        return promotedOut ? { ...g, tabs, previewTabId: undefined } : { ...g, tabs }
      })
    }))
  },

  openOrFocusDashboardTab: (): string => {
    const state = get()

    // Focus an existing dashboard tab anywhere (singleton).
    for (const g of state.groups) {
      const existing = g.tabs.find((t) => isDashboardTab(t))
      if (existing) {
        set({
          activeGroupId: g.id,
          groups: state.groups.map((gg) =>
            gg.id === g.id ? { ...gg, activeTabId: existing.id } : gg
          )
        })
        return existing.id
      }
    }

    const tab: DashboardTab = {
      id: makeTerminalId(),
      title: 'Dashboard',
      kind: 'dashboard'
    }

    // No groups yet — create the first group.
    const targetGroupId = state.activeGroupId
    if (state.groups.length === 0 || !targetGroupId) {
      const newGroup: EditorGroup = {
        id: 'group-0',
        tabs: [tab],
        activeTabId: tab.id
      }
      set({
        groups: [newGroup],
        layout: { type: 'group', groupId: newGroup.id },
        activeGroupId: newGroup.id
      })
      return tab.id
    }

    const targetGroup = state.groups.find((g) => g.id === targetGroupId)
    if (!targetGroup) {
      const gid = makeGroupId()
      const newGroup: EditorGroup = { id: gid, tabs: [tab], activeTabId: tab.id }
      set({ groups: [...state.groups, newGroup], activeGroupId: gid })
      return tab.id
    }

    set({
      groups: state.groups.map((g) =>
        g.id === targetGroupId ? { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id } : g
      ),
      activeGroupId: targetGroupId
    })
    return tab.id
  }
}))

// Debounced auto-save: persist workspace state 2s after last change
let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Internal — exported only for tests. Returns the JSON shape we persist.
 * The shape is intentionally `unknown` at module boundary to discourage
 * external coupling.
 */
export function _serializeWorkspaceForTests(): unknown {
  return serializeWorkspace()
}

function serializeWorkspace(): unknown {
  const { groups, layout, activeGroupId } = useTerminalStore.getState()
  return {
    layout,
    groups: groups.map((g) => ({
      id: g.id,
      tabs: g.tabs
        // Persist AI session terminal tabs (have a `command`) and
        // PERMANENT fileDiff / fileEditor tabs. Plain shell terminals and
        // preview tabs are intentionally NOT persisted.
        .filter((t) => {
          if (isFileDiffTab(t)) return t.preview !== true
          if (isFileEditorTab(t)) return t.preview !== true
          if (isDashboardTab(t)) return true
          return isTerminalTab(t) && !!t.command
        })
        .map((t) => {
          if (isDashboardTab(t)) {
            return { kind: 'dashboard' as const, id: t.id, title: t.title, color: t.color }
          }
          if (isFileDiffTab(t)) {
            return {
              kind: 'fileDiff' as const,
              id: t.id,
              title: t.title,
              repoRootFs: t.repoRootFs,
              repoLabel: t.repoLabel,
              scope: t.scope,
              file: t.file,
              sideBySide: t.sideBySide,
              color: t.color
            }
          }
          if (isFileEditorTab(t)) {
            return {
              kind: 'fileEditor' as const,
              id: t.id,
              title: t.title,
              rootFs: t.rootFs,
              rootLabel: t.rootLabel,
              relPath: t.relPath,
              color: t.color
            }
          }
          return {
            id: t.id,
            title: t.title,
            cwd: t.cwd,
            command: t.command,
            sessionId: t.sessionId,
            providerId: t.providerId,
            worktreePath: t.worktreePath,
            worktreeBranch: t.worktreeBranch,
            color: t.color
          }
        }),
      activeTabId: g.activeTabId
      // previewTabId is deliberately NOT serialized — preview tabs are
      // transient and their slot is recomputed on first openOrFocusDiffTab
      // after restore.
    })),
    activeGroupId,
    savedAt: new Date().toISOString()
  }
}

/** Sync save — blocks until written. Use on beforeunload for reliable quit. */
export function persistWorkspaceNow(): void {
  const data = serializeWorkspace()
  window.dplex.sessions.saveWorkspaceSync(data)
}

function debouncedPersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const data = serializeWorkspace()
    window.dplex.sessions.saveWorkspace(data)
  }, 2000)
}

// Subscribe to state changes and auto-persist
useTerminalStore.subscribe((state, prevState) => {
  // Don't auto-save during restore or before any groups exist
  if (!state.restored && state.groups.length === 0) return
  if (state.groups !== prevState.groups || state.layout !== prevState.layout) {
    debouncedPersist()
  }
})

function insertSplitAtPosition(
  node: LayoutNode,
  targetGroupId: string,
  newGroupId: string,
  direction: 'horizontal' | 'vertical',
  position: 'before' | 'after'
): LayoutNode {
  if (node.type === 'group' && node.groupId === targetGroupId) {
    const children =
      position === 'before'
        ? [{ type: 'group' as const, groupId: newGroupId }, node]
        : [node, { type: 'group' as const, groupId: newGroupId }]
    return { type: 'split', direction, children }
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) =>
        insertSplitAtPosition(child, targetGroupId, newGroupId, direction, position)
      )
    }
  }
  return node
}
