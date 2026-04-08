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
    return (
      <button
        onClick={toggleSidebar}
        className="absolute top-12 left-2 z-10 p-1.5 text-zinc-500 hover:text-white hover:bg-[#1e1e38] rounded transition-colors"
        title="Show sidebar (⌘B)"
      >
        <PanelLeftOpen size={16} />
      </button>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#141428] border-r border-[#2a2a4a] w-[260px] flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-[#2a2a4a]">
        <span className="text-xs font-semibold text-zinc-300 tracking-wide">SESSIONS</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refreshSessions()}
            className="p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Refresh sessions"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="flex items-center gap-1.5 bg-[#1a1a2e] rounded px-2 py-1 border border-[#2a2a4a] focus-within:border-blue-500/50 transition-colors">
          <Search size={12} className="text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none w-full"
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
