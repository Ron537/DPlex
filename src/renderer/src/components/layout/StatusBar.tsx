import { useState, useEffect } from 'react'
import { Terminal, FolderOpen, Cpu, PanelLeftOpen, PanelLeftClose, Settings } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getTerminalEntry } from '../../services/terminalRegistry'

interface StatusBarProps {
  onOpenSettings: () => void
}

function shortenPath(path: string): string {
  const home = '/Users/'
  if (path.startsWith(home)) {
    const afterUsers = path.slice(home.length)
    const slashIdx = afterUsers.indexOf('/')
    if (slashIdx === -1) return '~'
    return '~' + afterUsers.slice(slashIdx)
  }
  return path
}

export function StatusBar({ onOpenSettings }: StatusBarProps): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const activeGroupId = useTerminalStore((s) => s.activeGroupId)
  const activeGroup = groups.find((g) => g.id === activeGroupId)
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  const totalTerminals = groups.reduce((sum, g) => sum + g.tabs.length, 0)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const [cwd, setCwd] = useState('~')

  // Poll cwd of active terminal
  useEffect(() => {
    if (!activeTab) return
    const entry = getTerminalEntry(activeTab.id)
    if (!entry?.ptyId) return

    const fetchCwd = (): void => {
      window.dplex.pty.getCwd(entry.ptyId!).then((result) => {
        if (result) setCwd(shortenPath(result))
      }).catch(() => {})
    }

    fetchCwd()
    const interval = setInterval(fetchCwd, 3000)
    return () => clearInterval(interval)
  }, [activeTab?.id])

  return (
    <div className="flex items-center justify-between h-6 px-1 text-[10px] select-none" style={{ backgroundColor: 'var(--dplex-bg-alt)', borderTop: '1px solid var(--dplex-border)', color: 'var(--dplex-text-muted)' }}>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="p-0.5 hover:text-white hover:bg-white/10 rounded transition-colors"
          title={sidebarVisible ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
        >
          {sidebarVisible ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
        </button>
        <span className="flex items-center gap-1">
          <FolderOpen size={10} />
          {cwd}
        </span>
        <span className="flex items-center gap-1">
          <Cpu size={10} />
          Copilot CLI
        </span>
      </div>
      <div className="flex items-center gap-3 pr-1">
        {activeTab && (
          <span className="flex items-center gap-1">
            <Terminal size={10} />
            {activeTab.title}
          </span>
        )}
        <span>{totalTerminals} terminal{totalTerminals !== 1 ? 's' : ''} · {groups.length} group{groups.length !== 1 ? 's' : ''}</span>
        <button
          onClick={onOpenSettings}
          className="p-0.5 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Settings (⌘,)"
        >
          <Settings size={12} />
        </button>
      </div>
    </div>
  )
}
