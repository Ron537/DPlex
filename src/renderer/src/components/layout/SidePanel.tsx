import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  RefreshCw,
  SlidersHorizontal,
  Check,
  Plus,
  ChevronsDownUp,
  ChevronsUpDown
} from 'lucide-react'
import { MOD } from '../../utils/shortcuts'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProvidersStore } from '../../stores/providersStore'
import { useProjectStore } from '../../stores/projectStore'
import { SessionList } from '../sessions/SessionList'
import { ProjectList } from '../projects/ProjectList'
import { TagFilterBar } from '../projects/TagFilterBar'
import { ProjectPanelFooter } from '../projects/ProjectPanelFooter'
import { SessionPanelFooter } from '../sessions/SessionPanelFooter'
import { GitSidePanelView } from '../git/GitSidePanelView'
import { SearchSidePanelView } from '../search/SearchSidePanelView'

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
  const activeTab = useSettingsStore((s) => s.settings.sidebarActiveTab)
  const panelCollapsed = useSettingsStore((s) => s.settings.sidebarPanelCollapsed)
  const showFooter = useSettingsStore((s) => s.settings.projectPanelShowFooter)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const setSidebarWidth = useSettingsStore((s) => s.setSidebarWidth)
  const addProject = useProjectStore((s) => s.addProject)
  const getProviderLabel = useProvidersStore((s) => s.getLabel)
  const [groupMode, setGroupMode] = useState<SessionGroupMode>('time')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set(['all']))
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [projectSearchQuery, setProjectSearchQuery] = useState('')
  const [projectActiveOnly, setProjectActiveOnly] = useState(false)
  const [projectTagFilter, setProjectTagFilter] = useState<string | null>(null)
  const [showProjectFilterMenu, setShowProjectFilterMenu] = useState(false)
  // Collapse-all signal for SessionList groups. The nonce bumps each time
  // the user clicks the toolbar button so each <CollapsibleGroup> can react
  // (via a ref-tracked last-seen nonce) without losing its individual
  // toggle behavior in between presses.
  const [sessionCollapseAll, setSessionCollapseAll] = useState<{
    nonce: number
    collapsed: boolean
  }>({ nonce: 0, collapsed: false })
  const resizing = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus + select the search input when Cmd/Ctrl+F is pressed anywhere.
  // No-op while on the Git view (no search input mounted).
  useEffect(() => {
    const handler = (): void => {
      const input = searchInputRef.current
      if (!input) return
      input.focus()
      input.select()
    }
    window.addEventListener('dplex:focus-search', handler)
    return () => window.removeEventListener('dplex:focus-search', handler)
  }, [])

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
      options.push({ id, label: getProviderLabel(id), count })
    }
    return options
  }, [sessions, getProviderLabel])

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
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - startX)))
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

  if (!sidebarVisible || panelCollapsed) {
    // Activity bar is rendered outside this component; when the panel is
    // collapsed (or the whole sidebar is hidden) we render nothing here.
    return null
  }

  const title = activeTab === 'projects' ? 'Projects' : activeTab === 'sessions' ? 'Sessions' : null

  // Action buttons rendered in the header for the Projects/Sessions views.
  // Git view renders its own header (with refresh) inside GitSidePanelView.
  const headerActions =
    activeTab === 'projects' ? (
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            onClick={() => setShowProjectFilterMenu(!showProjectFilterMenu)}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
            style={{
              color: projectActiveOnly ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)'
            }}
            title="Filter projects"
          >
            <SlidersHorizontal size={13} />
          </button>
          {showProjectFilterMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowProjectFilterMenu(false)} />
              <div
                className="absolute right-0 top-7 z-50 rounded-lg shadow-xl py-1 min-w-[200px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-elev)',
                  border: '1px solid var(--dplex-border-strong)'
                }}
              >
                <div
                  className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--dplex-text-dim)' }}
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
                <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
                <div
                  className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--dplex-text-dim)' }}
                >
                  Appearance
                </div>
                <button
                  onClick={() => updateSettings({ projectPanelShowFooter: !showFooter })}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                  style={{ color: 'var(--dplex-text)' }}
                  title="Show live/terminal count at the bottom of the panel"
                >
                  Show Footer
                  {showFooter && <Check size={11} style={{ color: 'var(--dplex-accent)' }} />}
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => addProject()}
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Add project"
        >
          <Plus size={13} />
        </button>
      </div>
    ) : activeTab === 'sessions' ? (
      <div className="flex items-center gap-0.5">
        <button
          onClick={() =>
            setSessionCollapseAll((s) => ({ nonce: s.nonce + 1, collapsed: !s.collapsed }))
          }
          className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          style={{ color: 'var(--dplex-text-muted)' }}
          title={sessionCollapseAll.collapsed ? 'Expand all groups' : 'Collapse all groups'}
          aria-label={sessionCollapseAll.collapsed ? 'Expand all groups' : 'Collapse all groups'}
          data-testid="sessions-toggle-collapse-all"
        >
          {sessionCollapseAll.collapsed ? (
            <ChevronsUpDown size={13} />
          ) : (
            <ChevronsDownUp size={13} />
          )}
        </button>
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
            style={{
              color: hasActiveFilters ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)'
            }}
            title="Filter & group options"
          >
            <SlidersHorizontal size={13} />
          </button>
          {showFilterMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFilterMenu(false)} />
              <div
                className="absolute right-0 top-7 z-50 rounded-lg shadow-xl py-1 min-w-[220px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-elev)',
                  border: '1px solid var(--dplex-border-strong)'
                }}
              >
                <div
                  className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--dplex-text-dim)' }}
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
                <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
                <div
                  className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--dplex-text-dim)' }}
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
                      <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                    )}
                  </button>
                ))}
                {providerOptions.length > 2 && (
                  <>
                    <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
                    <div
                      className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--dplex-text-dim)' }}
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
                        <span style={{ color: 'var(--dplex-text-muted)' }}>({opt.count})</span>
                        {providerFilter === opt.id && (
                          <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
                        )}
                      </button>
                    ))}
                  </>
                )}
                <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
                <div
                  className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--dplex-text-dim)' }}
                >
                  Appearance
                </div>
                <button
                  onClick={() => updateSettings({ projectPanelShowFooter: !showFooter })}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                  style={{ color: 'var(--dplex-text)' }}
                  title="Show live/total count at the bottom of the panel"
                >
                  Show Footer
                  {showFooter && <Check size={11} style={{ color: 'var(--dplex-accent)' }} />}
                </button>
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
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    ) : null

  return (
    <div
      className="flex flex-col h-full flex-shrink-0 relative"
      style={{
        width: `${sidebarWidth}px`,
        backgroundColor: 'var(--dplex-bg-panel)',
        borderRight: '1px solid var(--dplex-border)'
      }}
    >
      {activeTab === 'git' ? (
        <GitSidePanelView />
      ) : activeTab === 'search' ? (
        <SearchSidePanelView />
      ) : (
        <>
          <div
            className="flex flex-col gap-2 px-3 pt-2 pb-2.5"
            style={{ borderBottom: '1px solid var(--dplex-border)' }}
          >
            <div className="flex items-center" style={{ height: 28 }}>
              <span
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--dplex-text)', letterSpacing: '0.08em' }}
              >
                {title}
              </span>
              <div className="ml-auto">{headerActions}</div>
            </div>
            <div className="relative">
              <Search
                size={13}
                style={{
                  position: 'absolute',
                  left: 9,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--dplex-text-dim)',
                  pointerEvents: 'none'
                }}
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={activeTab === 'projects' ? 'Search projects...' : 'Search sessions...'}
                value={activeTab === 'projects' ? projectSearchQuery : searchQuery}
                onChange={(e) =>
                  activeTab === 'projects'
                    ? setProjectSearchQuery(e.target.value)
                    : setSearchQuery(e.target.value)
                }
                className="w-full text-[12.5px] outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--dplex-bg-input)',
                  border: '1px solid var(--dplex-border)',
                  borderRadius: 8,
                  color: 'var(--dplex-text)',
                  padding: '8px 32px',
                  fontFamily: 'inherit'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--dplex-accent)'
                  e.currentTarget.style.boxShadow = '0 0 0 3px var(--dplex-accent-soft)'
                  e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--dplex-border)'
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.backgroundColor = 'var(--dplex-bg-input)'
                }}
              />
              <kbd
                className="absolute select-none text-[10px] font-medium pointer-events-none"
                style={{
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--dplex-text-dim)',
                  fontFamily: 'inherit'
                }}
                title={`Focus search (${MOD}F)`}
              >
                {MOD}F
              </kbd>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto dplex-scroll-autohide">
            {activeTab === 'projects' ? (
              <>
                <TagFilterBar value={projectTagFilter} onChange={setProjectTagFilter} />
                <ProjectList
                  searchQuery={projectSearchQuery}
                  activeOnly={projectActiveOnly}
                  tagFilter={projectTagFilter}
                />
              </>
            ) : (
              <SessionList
                groupMode={groupMode}
                providerFilter={providerFilter}
                statusFilters={statusFilters}
                collapseAllSignal={sessionCollapseAll}
              />
            )}
          </div>

          {activeTab === 'projects' && showFooter && <ProjectPanelFooter />}
          {activeTab === 'sessions' && showFooter && <SessionPanelFooter />}
        </>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--dplex-accent)] transition-colors z-10"
        style={{ opacity: 0.5 }}
      />
    </div>
  )
}
