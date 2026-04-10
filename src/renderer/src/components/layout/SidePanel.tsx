import { useState, useCallback, useRef } from 'react'
import { Search, PanelLeftClose, RefreshCw, FolderKanban, History, Clock, FolderOpen } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SessionList } from '../sessions/SessionList'
import { ProjectList } from '../projects/ProjectList'

type SidebarTab = 'projects' | 'sessions'
export type SessionGroupMode = 'time' | 'workspace'

const MIN_WIDTH = 200
const MAX_WIDTH = 500
const DEFAULT_WIDTH = 260

export function SidePanel(): JSX.Element {
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const loading = useSessionStore((s) => s.loading)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const [activeTab, setActiveTab] = useState<SidebarTab>('projects')
  const [groupMode, setGroupMode] = useState<SessionGroupMode>('time')
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const resizing = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    const startX = e.clientX
    const startWidth = width

    const onMouseMove = (e: MouseEvent): void => {
      if (!resizing.current) return
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)))
      setWidth(newWidth)
    }

    const onMouseUp = (): void => {
      resizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [width])

  if (!sidebarVisible) {
    return null
  }

  return (
    <div className="flex flex-col h-full flex-shrink-0 relative" style={{ width: `${width}px`, backgroundColor: 'var(--dplex-bg-alt)', borderRight: '1px solid var(--dplex-border)' }}>
      {/* Header with tab toggle */}
      <div className="flex items-center justify-between px-2 h-9" style={{ borderBottom: '1px solid var(--dplex-border)' }}>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setActiveTab('projects')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide transition-colors"
            style={{
              color: activeTab === 'projects' ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
              backgroundColor: activeTab === 'projects' ? 'var(--dplex-bg)' : 'transparent'
            }}
          >
            <FolderKanban size={11} />
            PROJECTS
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide transition-colors"
            style={{
              color: activeTab === 'sessions' ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
              backgroundColor: activeTab === 'sessions' ? 'var(--dplex-bg)' : 'transparent'
            }}
          >
            <History size={11} />
            HISTORY
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {activeTab === 'sessions' && (
            <>
              <button
                onClick={() => setGroupMode(groupMode === 'time' ? 'workspace' : 'time')}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title={groupMode === 'time' ? 'Group by workspace' : 'Group by time'}
              >
                {groupMode === 'time' ? <FolderOpen size={12} /> : <Clock size={12} />}
              </button>
              <button
                onClick={() => refreshSessions()}
                disabled={loading}
                className="p-1 hover:bg-white/10 rounded transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title="Refresh sessions"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          )}
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>

      {/* Search — only for sessions tab */}
      {activeTab === 'sessions' && (
        <div className="px-2 py-2">
          <div className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
            <Search size={12} style={{ color: 'var(--dplex-text-muted)' }} className="flex-shrink-0" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-xs placeholder-zinc-600 outline-none w-full"
              style={{ color: 'var(--dplex-text)' }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'projects' ? <ProjectList /> : <SessionList groupMode={groupMode} />}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--dplex-accent)] transition-colors z-10"
        style={{ opacity: 0.5 }}
      />
    </div>
  )
}
