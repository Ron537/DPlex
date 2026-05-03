import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  RefreshCw,
  SlidersHorizontal,
  Check,
  Plus,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderKanban,
  MessagesSquare
} from 'lucide-react'
import { MOD } from '../../utils/shortcuts'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProvidersStore } from '../../stores/providersStore'
import { useProjectStore } from '../../stores/projectStore'
import { SessionList } from '../sessions/SessionList'
import { ProjectList } from '../projects/ProjectList'
import { ProjectPanelFooter } from '../projects/ProjectPanelFooter'
import { Segmented } from '../common/Segmented'
import { useProjectAvatarFlip } from '../../hooks/useProjectAvatarFlip'
import { normalizePath } from '../../utils/normalizePath'

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
const COLLAPSED_WIDTH = 52

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
  // Covers both "open panel and focus search" and "re-focus while already open".
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

  const projects = useProjectStore((s) => s.projects)
  const hasActiveFilters =
    !statusFilters.has('all') || providerFilter !== 'all' || groupMode !== 'time'

  // Toolbar meta — small uppercase summary on the left of the toolbar row.
  // Mirrors the preview's "5 projects · 3 active" / "12 sessions" labels.
  // "active" counts distinct projects whose path matches a project's prefix
  // for at least one active session — *not* the raw active session count,
  // which would over-state when one project hosts multiple agents.
  const projectsWithActiveCount = useMemo(() => {
    if (projects.length === 0) return 0
    // Normalize project paths once for cross-platform comparison (handles
    // backslashes on Windows + case-insensitive matching on macOS/Windows).
    // Sort longest-first so nested project paths win over shorter parents.
    const normalizedProjects = projects
      .map((p) => normalizePath(p.path))
      .sort((a, b) => b.length - a.length)
    const owners = new Set<string>()
    for (const s of sessions) {
      if (s.status !== 'active' || !s.cwd) continue
      const cwd = normalizePath(s.cwd)
      const owner = normalizedProjects.find((p) => cwd === p || cwd.startsWith(p + '/'))
      if (owner) owners.add(owner)
    }
    return owners.size
  }, [projects, sessions])
  const toolbarMetaProjects = useMemo(() => {
    const total = projects.length
    const word = total === 1 ? 'project' : 'projects'
    if (projectsWithActiveCount === 0) return `${total} ${word}`
    return `${total} ${word} · ${projectsWithActiveCount} active`
  }, [projects.length, projectsWithActiveCount])
  const toolbarMetaSessions = useMemo(() => {
    const word = sessions.length === 1 ? 'session' : 'sessions'
    return `${sessions.length} ${word}`
  }, [sessions.length])

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

  // FLIP-animate project avatars between the expanded rows and the collapsed
  // rail when `panelCollapsed` toggles.
  useProjectAvatarFlip(panelCollapsed)

  if (!sidebarVisible) {
    return null
  }

  // Collapsed rail: a slim 52px column showing project avatars. Clicking an
  // avatar re-expands the panel and emphasizes that project.
  if (panelCollapsed) {
    return (
      <div
        className="flex flex-col h-full flex-shrink-0"
        style={{
          width: COLLAPSED_WIDTH,
          backgroundColor: 'var(--dplex-bg-activity)',
          borderRight: '1px solid var(--dplex-border)'
        }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar">
          <ProjectList compact />
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full flex-shrink-0 relative"
      style={{
        width: `${sidebarWidth}px`,
        backgroundColor: 'var(--dplex-bg-panel)',
        borderRight: '1px solid var(--dplex-border)'
      }}
    >
      {/* Header — segmented Projects/Sessions switcher + full-width search.
          Adornment buttons (filter, refresh) sit inside the search trail to
          keep the header tidy and match the preview rhythm. */}
      <div
        className="flex flex-col gap-2.5 px-3 pt-3 pb-2.5"
        style={{ borderBottom: '1px solid var(--dplex-border)' }}
      >
        <Segmented<'projects' | 'sessions'>
          value={activeTab}
          onChange={(next) => updateSettings({ sidebarActiveTab: next })}
          options={[
            {
              value: 'projects',
              label: 'Projects',
              icon: <FolderKanban size={13} />,
              ariaLabel: 'Projects'
            },
            {
              value: 'sessions',
              label: 'Sessions',
              icon: <MessagesSquare size={13} />,
              ariaLabel: 'Sessions'
            }
          ]}
        />
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

      {/* Toolbar — meta on the left, action buttons on the right. The exact
          buttons differ per tab. */}
      <div
        className="flex items-center justify-between px-3 py-2 relative"
        style={{ borderBottom: '1px solid var(--dplex-border)' }}
      >
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--dplex-text-dim)' }}
        >
          {activeTab === 'projects' ? toolbarMetaProjects : toolbarMetaSessions}
        </div>
        <div className="flex items-center gap-0.5">
          {activeTab === 'projects' && (
            <>
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
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowProjectFilterMenu(false)}
                    />
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

                      <div
                        className="my-1"
                        style={{ borderTop: '1px solid var(--dplex-border)' }}
                      />
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
            </>
          )}
          {activeTab === 'sessions' && (
            <>
              <button
                onClick={() =>
                  setSessionCollapseAll((s) => ({ nonce: s.nonce + 1, collapsed: !s.collapsed }))
                }
                className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title={sessionCollapseAll.collapsed ? 'Expand all groups' : 'Collapse all groups'}
                aria-label={
                  sessionCollapseAll.collapsed ? 'Expand all groups' : 'Collapse all groups'
                }
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

                      <div
                        className="my-1"
                        style={{ borderTop: '1px solid var(--dplex-border)' }}
                      />

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
                          <div
                            className="my-1"
                            style={{
                              borderTop: '1px solid var(--dplex-border)'
                            }}
                          />
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
                              <span style={{ color: 'var(--dplex-text-muted)' }}>
                                ({opt.count})
                              </span>
                              {providerFilter === opt.id && (
                                <Check size={11} style={{ color: 'var(--dplex-accent)' }} />
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
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'projects' ? (
          <ProjectList searchQuery={projectSearchQuery} activeOnly={projectActiveOnly} />
        ) : (
          <SessionList
            groupMode={groupMode}
            providerFilter={providerFilter}
            statusFilters={statusFilters}
            collapseAllSignal={sessionCollapseAll}
          />
        )}
      </div>

      {/* Project panel footer — live/terminal health summary. */}
      {activeTab === 'projects' && showFooter && <ProjectPanelFooter />}

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--dplex-accent)] transition-colors z-10"
        style={{ opacity: 0.5 }}
      />
    </div>
  )
}
