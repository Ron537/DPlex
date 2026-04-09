import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SidePanel } from './SidePanel'
import { StatusBar } from './StatusBar'
import { GroupLayout } from '../terminal/GroupLayout'
import { SettingsModal } from '../settings/SettingsModal'
import { useSessions } from '../../hooks/useSessions'
import { getTheme } from '../../services/themes'

export function AppLayout(): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const layout = useTerminalStore((s) => s.layout)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const themeId = useSettingsStore((s) => s.settings.theme)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const theme = getTheme(themeId)

  // Apply theme CSS variables
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--dplex-bg', theme.ui.bg)
    root.style.setProperty('--dplex-bg-alt', theme.ui.bgAlt)
    root.style.setProperty('--dplex-border', theme.ui.border)
    root.style.setProperty('--dplex-text', theme.ui.text)
    root.style.setProperty('--dplex-text-muted', theme.ui.textMuted)
    root.style.setProperty('--dplex-accent', theme.ui.accent)
    document.body.style.backgroundColor = theme.ui.bg
  }, [themeId])

  useSessions()

  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current && groups.length === 0) {
      initialized.current = true
      createTerminal()
    }
  }, [])

  // Listen for settings open event from keyboard shortcut
  useEffect(() => {
    const handler = (): void => setSettingsOpen(true)
    window.addEventListener('dplex:open-settings', handler)
    return () => window.removeEventListener('dplex:open-settings', handler)
  }, [])

  return (
    <div className="flex flex-col h-screen text-white overflow-hidden" style={{ backgroundColor: theme.ui.bg, color: theme.ui.text }}>
      {/* macOS title bar / drag region */}
      <div className="h-10 drag-region flex-shrink-0 flex items-center" style={{ backgroundColor: theme.ui.bgAlt, borderBottom: `1px solid ${theme.ui.border}` }}>
        <div className="w-[76px] flex-shrink-0" />
        <div className="flex-1 text-center">
          <span className="text-[11px] text-zinc-600 font-medium select-none">DPlex</span>
        </div>
        <div className="w-[76px] flex-shrink-0" />
      </div>

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
                  <div className="text-sm font-medium">DPlex</div>
                  <div className="text-xs mt-1 text-zinc-600">Press ⌘T to open a new terminal</div>
                </div>
              </div>
            )}
          </div>

          <StatusBar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
