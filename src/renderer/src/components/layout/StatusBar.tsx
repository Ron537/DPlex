import { Terminal, PanelLeftOpen, PanelLeftClose, Settings, Search, Focus, X } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useCommandPaletteStore } from '../../stores/commandPaletteStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTabFocusStore } from '../../stores/tabFocusStore'
import { getTabIdentity } from '../../utils/tabProject'
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
  const projects = useProjectStore((s) => s.projects)
  const focusedProjectId = useTabFocusStore((s) => s.focusedProjectId)
  const setFocusedProject = useTabFocusStore((s) => s.setFocusedProject)
  const toggleFocusedProject = useTabFocusStore((s) => s.toggleFocusedProject)
  const activeTabIdentity = activeTab ? getTabIdentity(activeTab, projects) : undefined
  const focusedProject = focusedProjectId
    ? projects.find((p) => p.id === focusedProjectId)
    : undefined

  return (
    <div
      className="flex items-center justify-between select-none flex-shrink-0"
      style={{
        height: 28,
        padding: '0 10px 0 6px',
        backgroundColor: 'var(--dplex-bg-alt)',
        borderTop: '1px solid var(--dplex-border-subtle)',
        fontSize: 11,
        color: 'var(--dplex-text-muted)',
        whiteSpace: 'nowrap'
      }}
    >
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          className="hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ padding: 4, color: 'var(--dplex-text-muted)' }}
          title={panelCollapsed ? `Show panel (${MOD}B)` : `Hide panel (${MOD}B)`}
        >
          {panelCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
        <button
          onClick={() => useCommandPaletteStore.getState().toggle('all')}
          className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)] transition-colors flex-shrink-0"
          style={{ height: 20, color: 'var(--dplex-text-muted)' }}
          title="Search projects, sessions, settings (try #tag)"
          aria-label={`Open command palette (${MOD}P)`}
        >
          <Search size={11} />
          <span>Search</span>
          <kbd
            className="font-medium"
            style={{
              fontSize: 10,
              padding: '1px 5px',
              borderRadius: 4,
              border: '1px solid var(--dplex-border)',
              color: 'var(--dplex-text-dim)',
              backgroundColor: 'var(--dplex-bg-elev)',
              fontFamily: 'var(--dplex-font-mono)'
            }}
          >
            {MOD}P
          </kbd>
        </button>
      </div>
      <div className="flex items-center gap-3 pr-1 min-w-0">
        {focusedProjectId ? (
          <button
            onClick={() => setFocusedProject(null)}
            className="inline-flex items-center gap-1.5 px-2 rounded-full transition-colors flex-shrink-0"
            style={{
              height: 20,
              border: '1px solid var(--dplex-accent-ring)',
              color: 'var(--dplex-text)',
              backgroundColor: 'var(--dplex-accent-soft)'
            }}
            title={
              focusedProject
                ? `Showing only tabs from "${focusedProject.name}". Click to clear.`
                : 'Clear stale focus filter'
            }
          >
            <Focus size={11} />
            <span className="truncate" style={{ maxWidth: 160 }}>
              Focus: {focusedProject?.name ?? 'cleared'}
            </span>
            <X size={11} />
          </button>
        ) : (
          activeTabIdentity && (
            <button
              onClick={() => toggleFocusedProject(activeTabIdentity.colorProject.id)}
              className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)] transition-colors flex-shrink-0"
              style={{ height: 20, color: 'var(--dplex-text-muted)' }}
              title={`Focus only tabs from "${activeTabIdentity.colorProject.name}"`}
            >
              <Focus size={11} />
              <span>Focus project</span>
            </button>
          )
        )}
        {activeSessionCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 px-2 rounded-full flex-shrink-0"
            style={{ height: 20, color: 'var(--dplex-status-success)' }}
            title={`${activeSessionCount} active AI session${activeSessionCount !== 1 ? 's' : ''}`}
          >
            <span
              className="dplex-pulse-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: 'var(--dplex-status-active)',
                boxShadow: '0 0 6px var(--dplex-status-active)'
              }}
            />
            <span style={{ fontFamily: 'var(--dplex-font-mono)' }}>{activeSessionCount}</span>{' '}
            active
          </span>
        )}
        {activeTab && (
          <span
            className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)] min-w-0"
            style={{ height: 20 }}
            title={activeTab.title}
          >
            <Terminal size={11} className="flex-shrink-0" />
            <span className="truncate" style={{ maxWidth: 240 }}>
              {activeTab.title}
            </span>
          </span>
        )}
        <span
          className="inline-flex items-center gap-1.5 px-2 rounded-full hover:bg-[var(--dplex-hover)] flex-shrink-0"
          style={{ height: 20, fontFamily: 'var(--dplex-font-mono)' }}
        >
          {totalTerminals} terminal{totalTerminals !== 1 ? 's' : ''} · {groups.length} group
          {groups.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={onOpenSettings}
          className="hover:bg-[var(--dplex-hover)] rounded transition-colors flex-shrink-0"
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
