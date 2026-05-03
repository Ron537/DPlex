import { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ProviderIconSprite } from './components/common/ProviderIconSprite'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProvidersStore } from './stores/providersStore'

function App(): React.JSX.Element {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadProviders = useProvidersStore((s) => s.load)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const splitGroup = useTerminalStore((s) => s.splitGroup)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)

  useEffect(() => {
    loadSettings()
    loadProviders()
  }, [loadSettings, loadProviders])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const state = useTerminalStore.getState()
      const activeGroup = state.groups.find((g) => g.id === state.activeGroupId)

      if (meta && e.key === 't') {
        e.preventDefault()
        createTerminal(state.activeGroupId ?? undefined)
      }

      if (meta && e.key === 'w') {
        e.preventDefault()
        if (activeGroup) closeTerminal(activeGroup.activeTabId)
      }

      if (meta && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      if (meta && e.key === 'f') {
        e.preventDefault()
        // Expand the panel if it's collapsed so the search input is mounted.
        const settings = useSettingsStore.getState().settings
        if (settings.sidebarPanelCollapsed) {
          useSettingsStore.getState().updateSettings({ sidebarPanelCollapsed: false })
        }
        // Defer to next frame so the input exists in the DOM before we focus.
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent('dplex:focus-search'))
        })
      }

      if (meta && e.key === ',') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('dplex:open-settings'))
      }

      if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'horizontal')
      }

      if (meta && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'vertical')
      }

      if (meta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        // Flatten groups in visual (layout-tree) order, then concatenate
        // their tabs so CMD/CTRL+1..9 selects the Nth tab globally across
        // all split groups, not just within the active one.
        const orderedGroupIds: string[] = []
        const walk = (node: typeof state.layout): void => {
          if (node.type === 'group' && node.groupId) {
            orderedGroupIds.push(node.groupId)
          } else if (node.children) {
            for (const c of node.children) walk(c)
          }
        }
        walk(state.layout)
        const orderedGroups = orderedGroupIds
          .map((id) => state.groups.find((g) => g.id === id))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
        const flatTabs = orderedGroups.flatMap((g) => g.tabs.map((t) => ({ groupId: g.id, tabId: t.id })))
        const idx = parseInt(e.key) - 1
        if (idx < flatTabs.length) {
          const target = flatTabs[idx]
          setActiveGroup(target.groupId)
          setActiveTerminalInGroup(target.groupId, target.tabId)
        }
      }
    },
    [createTerminal, closeTerminal, toggleSidebar, splitGroup, setActiveGroup, setActiveTerminalInGroup]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
      <ProviderIconSprite />
      <AppLayout />
    </>
  )
}

export default App
