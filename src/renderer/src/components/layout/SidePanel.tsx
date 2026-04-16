import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Search,
  PanelLeftClose,
  RefreshCw,
  FolderKanban,
  History,
  SlidersHorizontal,
  Check,
  Plus
} from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { SessionList } from '../sessions/SessionList'
import { ProjectList } from '../projects/ProjectList'

type SidebarTab = 'projects' | 'sessions'
export type SessionGroupMode = 'time' | 'workspace'

const STATUS_OPTIONS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'running', label: 'Running' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'idle', label: 'Idle' }
]

const MIN_WIDTH = 200
const MAX_WIDTH = 500

export function SidePanel(): React.JSX.Element | null {
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const loading = useSessionStore((s) => s.loading)
  const sessions = useSessionStore((s) => s.sessions)
  const sidebarVisible = useSettingsStore((s) => s.settings.sidebarVisible)
  const sidebarWidth = useSettingsStore((s) => s.settings.sidebarWidth)
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const addProject = useProjectStore((s) => s.addProject)
  const [activeTab, setActiveTab] = useState<SidebarTab>('projects')
  const [groupMode, setGroupMode] = useState<SessionGroupMode>('time')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(['all']))
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [projectActiveOnly, setProjectActiveOnly] = useState(false)
  const [showProjectFilterMenu, setShowProjectFilterMenu] = useState(false)
  const resizing = useRef(false)

  // Compute available providers and counts
  const providerOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions) {
      counts.set(s.aiTool, (counts.get(s.aiTool) ?? 0) + 1)
    }
    const options: { id: string; label: string; count: number }[] = [
      { id: 'all', label: 'All Providers', count: sessions.length }
    ]
    for (const [id, count] of counts) {
      const label = id === 'copilot-cli' ? 'Copilot' : id
      options.push({ id, label, count })
    }
    return options
  }, [sessions])

  const hasActiveFilters =
    !statusFilters.has('all') || providerFilter !== 'all' || groupMode !== 'time'

  const toggleStatusFilter = (id: string): void => {
    setStatusFilters((prev) => {
      if (id === 'all') return new Set(['all'])
      const next = new Set(prev)
      next.delete('all')
      if (next.has(id)) {
        next.delete(id)
        if (next.size === 0) return new Set(['all'])
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      resizing.current = true
      const startX = e.clientX
      const startWidth = sidebarWidth

      const onMouseMove = (e: MouseEvent): void => {
        if (!resizing.current) return
        const newWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, startWidth + (e.clientX - startX))
        )
        setSidebarWidth(newWidth)
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
    },
    [sidebarWidth, setSidebarWidth]
  )

  if (!sidebarVisible) {
    return null
  }

  return (
    <div
      className="flex flex-col h-full flex-shrink-0 relative"
      style={{
        width: `${sidebarWidth}px`,
        backgroundColor: 'var(--dplex-bg-alt)',
        borderRight: '1px solid var(--dplex-border)'
      }}
    >
      {/* Header with tab toggle */}
      <div
        className="flex items-center justify-between px-2 h-9"
        style={{ borderBottom: '1px solid var(--dplex-border)' }}
      >
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setActiveTab('projects')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide transition-colors"
            style={{
              color:
                activeTab === 'projects'
                  ? 'var(--dplex-text)'
                  : 'var(--dplex-text-muted)',
              backgroundColor:
                activeTab === 'projects' ? 'var(--dplex-bg)' : 'transparent'
            }}
          >
            <FolderKanban size={11} />
            PROJECTS
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold tracking-wide transition-colors"
            style={{
              color:
                activeTab === 'sessions'
                  ? 'var(--dplex-text)'
                  : 'var(--dplex-text-muted)',
              backgroundColor:
                activeTab === 'sessions' ? 'var(--dplex-bg)' : 'transparent'
            }}
          >
            <History size={11} />
            HISTORY
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {activeTab === 'projects' && (
            <>
              <button
                onClick={() => addProject()}
                className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title="Add project"
              >
                <Plus size={13} />
              </button>
              <div className="relative">
              <button
                onClick={() => setShowProjectFilterMenu(!showProjectFilterMenu)}
                className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
                style={{
                  color: projectActiveOnly
                    ? 'var(--dplex-accent)'
                    : 'var(--dplex-text-muted)'
                }}
                title="Filter projects"
              >
                <SlidersHorizontal size={12} />
              </button>

              {showProjectFilterMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowProjectFilterMenu(false)}
                  />
                  <div
                    className="absolute right-0 top-7 z-50 rounded shadow-xl py-1 min-w-[180px]"
                    style={{
                      backgroundColor: 'var(--dplex-bg)',
                      border: '1px solid var(--dplex-border)'
                    }}
                  >
                    <div
                      className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--dplex-text-muted)' }}
                    >
                      Show
                    </div>
                    <button
                      onClick={() => setProjectActiveOnly(false)}
                      className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                      style={{ color: 'var(--dplex-text)' }}
                    >
                      All Projects
                      {!projectActiveOnly && (
                        <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                      )}
                    </button>
                    <button
                      onClick={() => setProjectActiveOnly(true)}
                      className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                      style={{ color: 'var(--dplex-text)' }}
                    >
                      Active Only
                      {projectActiveOnly && (
                        <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
            </>
          )}
          {activeTab === 'sessions' && (
            <>
              {/* Filter button */}
              <div className="relative">
                <button
                  onClick={() => setShowFilterMenu(!showFilterMenu)}
                  className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
                  style={{
                    color: hasActiveFilters
                      ? 'var(--dplex-accent)'
                      : 'var(--dplex-text-muted)'
                  }}
                  title="Filter & group options"
                >
                  <SlidersHorizontal size={12} />
                </button>

                {/* Filter dropdown menu */}
                {showFilterMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowFilterMenu(false)}
                    />
                    <div
                      className="absolute right-0 top-7 z-50 rounded shadow-xl py-1 min-w-[200px]"
                      style={{
                        backgroundColor: 'var(--dplex-bg)',
                        border: '1px solid var(--dplex-border)'
                      }}
                    >
                      {/* Group by section */}
                      <div
                        className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--dplex-text-muted)' }}
                      >
                        Group by
                      </div>
                      <button
                        onClick={() => setGroupMode('time')}
                        className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                        style={{ color: 'var(--dplex-text)' }}
                      >
                        Time
                        {groupMode === 'time' && (
                          <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                        )}
                      </button>
                      <button
                        onClick={() => setGroupMode('workspace')}
                        className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                        style={{ color: 'var(--dplex-text)' }}
                      >
                        Workspace
                        {groupMode === 'workspace' && (
                          <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                        )}
                      </button>

                      <div
                        className="my-1"
                        style={{ borderTop: '1px solid var(--dplex-border)' }}
                      />

                      {/* Status filter section (multi-select) */}
                      <div
                        className="px-3 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--dplex-text-muted)' }}
                      >
                        Status
                      </div>
                      {STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => toggleStatusFilter(opt.id)}
                          className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                          style={{ color: 'var(--dplex-text)' }}
                        >
                          {opt.label}
                          {statusFilters.has(opt.id) && (
                            <Check
                              size={11}
                              style={{ color: 'var(--dplex-accent)' }}
                            />
                          )}
                        </button>
                      ))}

                      {/* Provider filter section — only if multiple providers */}
                      {providerOptions.length > 2 && (
                        <>
                          <div
                            className="my-1"
                            style={{
                              borderTop: '1px solid var(--dplex-border)'
                            }}
                          />
                          <div
                            className="px-3 pt-1 pb-1 text-[9px] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--dplex-text-muted)' }}
                          >
                            Provider
                          </div>
                          {providerOptions.map((opt) => (
                            <button
                              key={opt.id}
                              onClick={() => setProviderFilter(opt.id)}
                              className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                              style={{ color: 'var(--dplex-text)' }}
                            >
                              {opt.label}{' '}
                              <span style={{ color: 'var(--dplex-text-muted)' }}>
                                ({opt.count})
                              </span>
                              {providerFilter === opt.id && (
                                <Check
                                  size={11}
                                  style={{ color: 'var(--dplex-accent)' }}
                                />
                              )}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => refreshSessions()}
                disabled={loading}
                className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title="Refresh sessions"
              >
                <RefreshCw
                  size={12}
                  className={loading ? 'animate-spin' : ''}
                />
              </button>
            </>
          )}
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div
          className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors"
          style={{
            backgroundColor: 'var(--dplex-bg)',
            border: '1px solid var(--dplex-border)'
          }}
        >
          <Search
            size={12}
            style={{ color: 'var(--dplex-text-muted)' }}
            className="flex-shrink-0"
          />
          <input
            type="text"
            placeholder={activeTab === 'projects' ? 'Search projects...' : 'Search sessions...'}
            value={activeTab === 'projects' ? projectSearchQuery : searchQuery}
            onChange={(e) =>
              activeTab === 'projects'
                ? setProjectSearchQuery(e.target.value)
                : setSearchQuery(e.target.value)
            }
            className="bg-transparent text-xs placeholder-zinc-600 outline-none w-full"
            style={{ color: 'var(--dplex-text)' }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'projects' ? (
          <ProjectList
            searchQuery={projectSearchQuery}
            activeOnly={projectActiveOnly}
          />
        ) : (
          <SessionList
            groupMode={groupMode}
            providerFilter={providerFilter}
            statusFilters={statusFilters}
          />
        )}
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
