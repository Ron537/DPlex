import { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SidePanel } from './SidePanel'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { useSessions } from '../../hooks/useSessions'

export function AppLayout(): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const layout = useTerminalStore((s) => s.layout)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)

  useSessions()

  // Create initial terminal on mount
  useEffect(() => {
    if (groups.length === 0) {
      createTerminal()
    }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#1a1a2e] text-white overflow-hidden">
      {/* macOS drag region */}
      <div className="h-3 bg-[#16162a] drag-region flex-shrink-0" />

      <div className="flex flex-1 min-h-0">
        {sidebarVisible && <SidePanel />}

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            {groups.length > 0 ? (
              <GroupLayout node={layout} />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">⬡</div>
                  <div className="text-sm font-medium">TPlex</div>
                  <div className="text-xs mt-1 text-zinc-600">Press ⌘T to open a new terminal</div>
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
