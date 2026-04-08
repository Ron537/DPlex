import { create } from 'zustand'
import type { TabData, PaneNode } from '../types'

let tabCounter = 0

function makeTerminalId(): string {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function makeTab(title?: string, terminalId?: string): TabData {
  tabCounter++
  const id = terminalId ?? makeTerminalId()
  return {
    id: `tab-${tabCounter}`,
    title: title ?? `Terminal ${tabCounter}`,
    paneTree: { type: 'terminal', terminalId: id }
  }
}

function collectTerminalIds(node: PaneNode): string[] {
  if (node.type === 'terminal' && node.terminalId) return [node.terminalId]
  if (node.children) return node.children.flatMap(collectTerminalIds)
  return []
}

function removeTerminalFromTree(node: PaneNode, terminalId: string): PaneNode | null {
  if (node.type === 'terminal') {
    return node.terminalId === terminalId ? null : node
  }
  if (!node.children) return node
  const filtered = node.children
    .map((child) => removeTerminalFromTree(child, terminalId))
    .filter(Boolean) as PaneNode[]
  if (filtered.length === 0) return null
  if (filtered.length === 1) return filtered[0]
  return { ...node, children: filtered }
}

interface TerminalState {
  tabs: TabData[]
  activeTabId: string | null
  activeTerminalId: string | null

  createTab: (title?: string, initialCommand?: string) => string
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  renameTab: (tabId: string, title: string) => void
  setActiveTerminal: (terminalId: string) => void

  splitTerminal: (terminalId: string, direction: 'horizontal' | 'vertical') => string
  closePane: (terminalId: string) => void

  getActiveTab: () => TabData | undefined
  getAllTerminalIds: () => string[]

  // Track commands to run after PTY creation
  pendingCommands: Map<string, string>
  popPendingCommand: (terminalId: string) => string | undefined
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  activeTerminalId: null,
  pendingCommands: new Map(),

  createTab: (title?: string, initialCommand?: string) => {
    const termId = makeTerminalId()
    const tab = makeTab(title, termId)
    if (initialCommand) {
      get().pendingCommands.set(termId, initialCommand)
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeTerminalId: termId
    }))
    return termId
  },

  closeTab: (tabId) => {
    const state = get()
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab) return

    const remaining = state.tabs.filter((t) => t.id !== tabId)
    const newActive =
      state.activeTabId === tabId
        ? remaining.length > 0
          ? remaining[Math.max(0, state.tabs.indexOf(tab) - 1)]?.id ?? remaining[0]?.id
          : null
        : state.activeTabId

    const newActiveTerminal = newActive
      ? collectTerminalIds(remaining.find((t) => t.id === newActive)!.paneTree)[0] ?? null
      : null

    set({
      tabs: remaining,
      activeTabId: newActive,
      activeTerminalId: newActiveTerminal
    })
  },

  closeOtherTabs: (tabId) => {
    const state = get()
    set({
      tabs: state.tabs.filter((t) => t.id === tabId),
      activeTabId: tabId,
      activeTerminalId: collectTerminalIds(
        state.tabs.find((t) => t.id === tabId)!.paneTree
      )[0]
    })
  },

  setActiveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    const terminalId = collectTerminalIds(tab.paneTree)[0] ?? null
    set({ activeTabId: tabId, activeTerminalId: terminalId })
  },

  renameTab: (tabId, title) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t))
    }))
  },

  setActiveTerminal: (terminalId) => {
    set({ activeTerminalId: terminalId })
  },

  splitTerminal: (terminalId, direction) => {
    const newId = makeTerminalId()
    set((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        paneTree: splitNode(tab.paneTree, terminalId, direction, newId)
      })),
      activeTerminalId: newId
    }))
    return newId
  },

  closePane: (terminalId) => {
    set((state) => {
      const newTabs = state.tabs
        .map((tab) => {
          const newTree = removeTerminalFromTree(tab.paneTree, terminalId)
          if (!newTree) return null
          return { ...tab, paneTree: newTree }
        })
        .filter(Boolean) as TabData[]

      const activeTab = newTabs.find((t) => t.id === state.activeTabId)
      const newActiveTerminal = activeTab ? collectTerminalIds(activeTab.paneTree)[0] : null

      return {
        tabs: newTabs,
        activeTabId: activeTab?.id ?? newTabs[0]?.id ?? null,
        activeTerminalId:
          state.activeTerminalId === terminalId
            ? newActiveTerminal
            : state.activeTerminalId
      }
    })
  },

  getActiveTab: () => {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId)
  },

  getAllTerminalIds: () => {
    return get().tabs.flatMap((tab) => collectTerminalIds(tab.paneTree))
  },

  popPendingCommand: (terminalId) => {
    const cmd = get().pendingCommands.get(terminalId)
    if (cmd) {
      get().pendingCommands.delete(terminalId)
    }
    return cmd
  }
}))

function splitNode(
  node: PaneNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newTerminalId: string
): PaneNode {
  if (node.type === 'terminal' && node.terminalId === targetId) {
    return {
      type: 'split',
      direction,
      children: [node, { type: 'terminal', terminalId: newTerminalId }],
      sizes: [50, 50]
    }
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((child) =>
        splitNode(child, targetId, direction, newTerminalId)
      )
    }
  }
  return node
}
