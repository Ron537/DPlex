import { useState, useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { SettingsModal } from './components/settings/SettingsModal'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'

function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
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

      // Cmd+T — new terminal in active group
      if (meta && e.key === 't') {
        e.preventDefault()
        createTerminal(state.activeGroupId ?? undefined)
      }

      // Cmd+W — close active terminal
      if (meta && e.key === 'w') {
        e.preventDefault()
        if (activeGroup) {
          closeTerminal(activeGroup.activeTabId)
        }
      }

      // Cmd+B — toggle sidebar
      if (meta && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Cmd+, — settings
      if (meta && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }

      // Cmd+\ — split group right
      if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'horizontal')
      }

      // Cmd+Shift+\ — split group down
      if (meta && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (state.activeGroupId) splitGroup(state.activeGroupId, 'vertical')
      }

      // Cmd+1-9 — switch tabs in active group
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

  return (
    <>
      <AppLayout />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

export default App
