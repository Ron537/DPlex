import type { SearchItem, SearchSource } from './types'
import { isTerminalTab, isFileDiffTab } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { pathBasename } from './pathUtils'

function focusTab(groupId: string, tabId: string): void {
  const ts = useTerminalStore.getState()
  ts.setActiveGroup(groupId)
  ts.setActiveTerminalInGroup(groupId, tabId)
}

export const tabsSource: SearchSource = {
  category: 'tabs',
  getItems: (ctx): SearchItem[] => {
    const items: SearchItem[] = []
    let groupIdx = 0
    for (const group of ctx.groups) {
      groupIdx++
      const groupHint = ctx.groups.length > 1 ? `Group ${groupIdx}` : undefined
      for (const tab of group.tabs) {
        if (isFileDiffTab(tab)) {
          items.push({
            id: `tab:${tab.id}`,
            category: 'tabs',
            label: tab.title,
            description: `Diff · ${tab.repoLabel}`,
            hint: groupHint,
            keywords: ['diff', tab.repoLabel, tab.repoRootFs],
            run: () => focusTab(group.id, tab.id)
          })
          continue
        }
        if (!isTerminalTab(tab)) continue
        const desc = tab.cwd ? pathBasename(tab.cwd) : tab.command || ''
        const keywords: string[] = []
        if (tab.cwd) keywords.push(tab.cwd, pathBasename(tab.cwd))
        if (tab.command) keywords.push(tab.command)
        if (tab.providerId) keywords.push(tab.providerId)
        if (tab.worktreeBranch) keywords.push(tab.worktreeBranch)
        items.push({
          id: `tab:${tab.id}`,
          category: 'tabs',
          label: tab.title,
          description: desc,
          hint: groupHint,
          keywords,
          run: () => focusTab(group.id, tab.id)
        })
      }
    }
    return items
  }
}
