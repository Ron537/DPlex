import { useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'

function App(): React.JSX.Element {
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const closeTerminal = useTerminalStore((s) => s.closeTerminal)
  const splitGroup = useTerminalStore((s) => s.splitGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

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
        if (activeGroup) {
          const idx = parseInt(e.key) - 1
          if (idx < activeGroup.tabs.length) {
            setActiveTerminalInGroup(activeGroup.id, activeGroup.tabs[idx].id)
          }
        }
      }
    },
    [createTerminal, closeTerminal, toggleSidebar, splitGroup, setActiveTerminalInGroup]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return <AppLayout />
}

export default App
