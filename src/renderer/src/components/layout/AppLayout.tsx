import { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SidePanel } from './SidePanel'
import { TabBar } from './TabBar'
import { StatusBar } from './StatusBar'
import { SplitContainer } from '../terminal/SplitContainer'
import { useSessions } from '../../hooks/useSessions'

export function AppLayout(): JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTabId = useTerminalStore((s) => s.activeTabId)
  const createTab = useTerminalStore((s) => s.createTab)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)

  // Poll sessions
  useSessions()

  // Create initial tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTab()
    }
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e] text-white overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {/* Side Panel */}
        {sidebarVisible && <SidePanel />}

        {/* Main Area */}
        <div className="flex flex-col flex-1 min-w-0">
          <TabBar />

          {/* Terminal Area */}
          <div className="flex-1 min-h-0">
            {activeTab ? (
              <SplitContainer node={activeTab.paneTree} />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">⬡</div>
                  <div className="text-sm font-medium">TPlex</div>
                  <div className="text-xs mt-1 text-zinc-600">
                    Press ⌘T to open a new terminal
                  </div>
                </div>
              </div>
            )}
          </div>

          <StatusBar />
        </div>
      </div>
    </div>
  )
}
