import { useState, useEffect, useCallback } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { SettingsModal } from './components/settings/SettingsModal'
import { useSettingsStore } from './stores/settingsStore'
import { useTerminalStore } from './stores/terminalStore'

function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const createTab = useTerminalStore((s) => s.createTab)
  const closeTab = useTerminalStore((s) => s.closeTab)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const tabs = useTerminalStore((s) => s.tabs)
  const setActiveTab = useTerminalStore((s) => s.setActiveTab)
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId)
  const splitTerminal = useTerminalStore((s) => s.splitTerminal)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+T — new tab
      if (meta && e.key === 't') {
        e.preventDefault()
        createTab()
      }

      // Cmd+W — close tab
      if (meta && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
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

      // Cmd+\ — split right
      if (meta && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (activeTerminalId) splitTerminal(activeTerminalId, 'horizontal')
      }

      // Cmd+Shift+\ — split down
      if (meta && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (activeTerminalId) splitTerminal(activeTerminalId, 'vertical')
      }

      // Cmd+1-9 — switch tabs
      if (meta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        if (idx < tabs.length) {
          setActiveTab(tabs[idx].id)
        }
      }
    },
    [activeTabId, activeTerminalId, tabs, createTab, closeTab, toggleSidebar, splitTerminal, setActiveTab]
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
