import { Terminal, PanelLeftOpen, PanelLeftClose, Settings } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { MOD } from '../../utils/shortcuts'

interface StatusBarProps {
  onOpenSettings: () => void
}

export function StatusBar({ onOpenSettings }: StatusBarProps): React.JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const activeGroupId = useTerminalStore((s) => s.activeGroupId)
  const activeGroup = groups.find((g) => g.id === activeGroupId)
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  const totalTerminals = groups.reduce((sum, g) => sum + g.tabs.length, 0)
  const panelCollapsed = useSettingsStore((s) => s.settings.sidebarPanelCollapsed)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionCount = sessions.filter((s) => s.status === 'active').length

  return (
    <div
      className="flex items-center justify-between select-none"
      style={{
        height: 26,
        padding: '0 8px 0 4px',
        backgroundColor: 'var(--dplex-bg-alt)',
        borderTop: '1px solid var(--dplex-border)',
        fontSize: 11,
        color: 'var(--dplex-text-muted)'
      }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ padding: 4, color: 'var(--dplex-text-muted)' }}
          title={panelCollapsed ? `Show panel (${MOD}B)` : `Hide panel (${MOD}B)`}
        >
          {panelCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>
      <div className="flex items-center gap-3 pr-1">
        {activeSessionCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 px-2 rounded-full"
            style={{ height: 18, color: '#86efac' }}
            title={`${activeSessionCount} active AI session${activeSessionCount !== 1 ? 's' : ''}`}
          >
            <span
              className="dplex-pulse-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: 'var(--dplex-status-active)'
              }}
            />
            {activeSessionCount} active
          </span>
        )}
        {activeTab && (
          <span
            className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)]"
            style={{ height: 18 }}
          >
            <Terminal size={11} />
            {activeTab.title}
          </span>
        )}
        <span
          className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)]"
          style={{ height: 18 }}
        >
          {totalTerminals} terminal{totalTerminals !== 1 ? 's' : ''} · {groups.length} group
          {groups.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onOpenSettings}
          className="hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ padding: 4, color: 'var(--dplex-text-muted)' }}
          title="Settings"
          aria-label={`Settings (${MOD},)`}
        >
          <Settings size={13} />
        </button>
      </div>
    </div>
  )
}
