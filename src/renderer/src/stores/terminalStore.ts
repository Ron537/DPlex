import { create } from 'zustand'
import type { TerminalTab, EditorGroup, LayoutNode } from '../types'
import { destroyTerminal } from '../services/terminalRegistry'

let tabCounter = 0
let groupCounter = 0

function makeTerminalId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function makeGroupId(): string {
  return `group-${++groupCounter}`
}

function makeTerminalTab(title?: string, id?: string, shell?: string, cwd?: string, command?: string): TerminalTab {
  tabCounter++
  return { id: id ?? makeTerminalId(), title: title ?? `Terminal ${tabCounter}`, shell, cwd, command }
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

  createTerminal: (groupId?: string, title?: string, command?: string, shell?: string, cwd?: string) => string
  closeTerminal: (terminalId: string) => void
  setActiveGroup: (groupId: string) => void
  setActiveTerminalInGroup: (groupId: string, terminalId: string) => void
  renameTerminal: (terminalId: string, title: string) => void
  splitGroup: (groupId: string, direction: 'horizontal' | 'vertical') => string
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
  restoreWorkspace: (groups: EditorGroup[], layout: LayoutNode, activeGroupId: string | null) => void
  setPid: (terminalId: string, pid: number) => void
  associateSessionId: (terminalId: string, sessionId: string) => void
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  groups: [],
  layout: { type: 'group', groupId: 'group-0' },
  activeGroupId: null,
  restored: false,
  createTerminal: (groupId?: string, title?: string, command?: string, shell?: string, cwd?: string) => {
    const state = get()
    const tab = makeTerminalTab(title, undefined, shell, cwd, command)
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
        g.id === targetGroupId
          ? { ...g, tabs: [...g.tabs, tab], activeTabId: tab.id }
          : g
      ),
      activeGroupId: targetGroupId
    })
    return tab.id
  },

  closeTerminal: (terminalId) => {
    const state = get()
    destroyTerminal(terminalId)

    const updatedGroups = state.groups.map((g) => {
      const idx = g.tabs.findIndex((t) => t.id === terminalId)
      if (idx === -1) return g
      const newTabs = g.tabs.filter((t) => t.id !== terminalId)
      const newActive =
        g.activeTabId === terminalId
          ? newTabs[Math.max(0, idx - 1)]?.id ?? null
          : g.activeTabId
      return { ...g, tabs: newTabs, activeTabId: newActive ?? '' }
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
      aliveGroups.find((g) => g.id === state.activeGroupId)?.id ??
      aliveGroups[0]?.id ??
      null

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
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, activeTabId: terminalId } : g
      ),
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

  splitGroup: (groupId, direction) => {
    const state = get()
    const newGid = makeGroupId()
    const tab = makeTerminalTab()
    const newGroup: EditorGroup = { id: newGid, tabs: [tab], activeTabId: tab.id }

    set({
      groups: [...state.groups, newGroup],
      layout: insertSplitInLayout(state.layout, groupId, newGid, direction),
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

    // Remove from source
    const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== terminalId)
    const newSourceActive =
      sourceGroup.activeTabId === terminalId
        ? newSourceTabs[0]?.id ?? ''
        : sourceGroup.activeTabId

    let updatedGroups = state.groups.map((g) => {
      if (g.id === sourceGroup.id) {
        return { ...g, tabs: newSourceTabs, activeTabId: newSourceActive }
      }
      if (g.id === targetGroupId) {
        const newTabs = [...g.tabs]
        if (insertIndex !== undefined) {
          newTabs.splice(insertIndex, 0, tab)
        } else {
          newTabs.push(tab)
        }
        return { ...g, tabs: newTabs, activeTabId: tab.id }
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

    // Create new group with this tab
    const newGid = makeGroupId()
    const newGroup: EditorGroup = { id: newGid, tabs: [tab], activeTabId: tab.id }

    // Remove from source
    const newSourceTabs = sourceGroup.tabs.filter((t) => t.id !== terminalId)
    const newSourceActive =
      sourceGroup.activeTabId === terminalId
        ? newSourceTabs[0]?.id ?? ''
        : sourceGroup.activeTabId

    let updatedGroups = state.groups.map((g) =>
      g.id === sourceGroup.id
        ? { ...g, tabs: newSourceTabs, activeTabId: newSourceActive }
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
    set({ groups, layout, activeGroupId, restored: true })
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
  }
}))

// Debounced auto-save: persist workspace state 2s after last change
let saveTimer: ReturnType<typeof setTimeout> | null = null

function serializeWorkspace(): unknown {
  const { groups, layout, activeGroupId } = useTerminalStore.getState()
  return {
    layout,
    groups: groups.map((g) => ({
      id: g.id,
      tabs: g.tabs
        .filter((t) => t.command) // Only persist AI session tabs
        .map((t) => ({
          id: t.id,
          title: t.title,
          cwd: t.cwd,
          command: t.command,
          sessionId: t.sessionId
        })),
      activeTabId: g.activeTabId
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
