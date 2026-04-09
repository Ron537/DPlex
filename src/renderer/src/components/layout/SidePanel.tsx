import { Search, PanelLeftClose, PanelLeftOpen, RefreshCw } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SessionList } from '../sessions/SessionList'

export function SidePanel(): JSX.Element {
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)

  if (!sidebarVisible) {
    return null
  }

  return (
    <div className="flex flex-col h-full w-[260px] flex-shrink-0" style={{ backgroundColor: 'var(--tplex-bg-alt)', borderRight: '1px solid var(--tplex-border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9" style={{ borderBottom: '1px solid var(--tplex-border)' }}>
        <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--tplex-text)' }}>SESSIONS</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refreshSessions()}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--tplex-text-muted)' }}
            title="Refresh sessions"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--tplex-text-muted)' }}
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors" style={{ backgroundColor: 'var(--tplex-bg)', border: '1px solid var(--tplex-border)' }}>
          <Search size={12} style={{ color: 'var(--tplex-text-muted)' }} className="flex-shrink-0" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs placeholder-zinc-600 outline-none w-full"
            style={{ color: 'var(--tplex-text)' }}
          />
        </div>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        <SessionList />
      </div>
    </div>
  )
}
