import { useState, useRef, useEffect } from 'react'
import { Bell, Check, Eye, X } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { ProjectAvatar } from '../projects/ProjectAvatar'
import { decideRowClickAction } from './rowClickAction'
import { normalizePath } from '../../utils/normalizePath'
import { colorSourceProject } from '../../utils/tabProject'
import type { AttentionEvent, AttentionKind } from '../../../../preload/attentionTypes'

const KIND_LABEL: Record<AttentionKind, string> = {
  waitingForApproval: 'Waiting for approval',
  waitingForInput: 'Waiting for input',
  finished: 'Finished'
}

const KIND_COLOR: Record<AttentionKind, string> = {
  waitingForApproval: 'var(--dplex-status-approval)',
  waitingForInput: 'var(--dplex-status-waiting)',
  finished: 'var(--dplex-status-thinking)'
}

const KIND_ORDER: AttentionKind[] = ['waitingForApproval', 'waitingForInput', 'finished']

function formatAge(since: number): string {
  const ms = Date.now() - since
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h`
}

export function AttentionBellButton(): React.JSX.Element {
  const active = useAttentionStore((s) => s.active)
  const unreadCount = useAttentionStore((s) => s.unreadCount)
  const acknowledge = useAttentionStore((s) => s.acknowledge)
  const acknowledgeAll = useAttentionStore((s) => s.acknowledgeAll)
  const dismiss = useAttentionStore((s) => s.dismiss)
  const clickClearsWaiting = useSettingsStore((s) => s.settings.attentionClickClearsWaiting)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const projects = useProjectStore((s) => s.projects)
  const sessions = useSessionStore((s) => s.sessions)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const visible = active.filter((e) => !e.suppressed)
  const grouped: Record<AttentionKind, AttentionEvent[]> = {
    waitingForApproval: [],
    waitingForInput: [],
    finished: []
  }
  for (const e of visible) grouped[e.kind].push(e)

  /** Best-effort project resolution for an attention event. Looks at the
   * matching session's cwd and finds the project whose path is a prefix
   * of it. Returns the most specific match (worktree before parent).
   *
   * Path comparison goes through `normalizePath` so it works across
   * platforms: backslashes are normalized to forward slashes, trailing
   * slashes are trimmed, and case is folded on macOS / Windows. Without
   * this, Windows users would never get a match (paths use backslashes
   * on disk but the prefix check would only succeed for slashes), and
   * the avatar would always fall back to the initial-letter placeholder.
   * Mirrors the same approach used by `findProjectForTab`. */
  const resolveProject = (
    event: AttentionEvent
  ): { id: string; name: string; tabColor?: string } | undefined => {
    const session = sessions.find((s) => s.id === event.sessionId && s.aiTool === event.providerId)
    const cwd = session?.cwd
    if (!cwd) return undefined
    const normCwd = normalizePath(cwd)
    let best: { id: string; name: string; tabColor?: string; len: number } | undefined
    for (const p of projects) {
      const normProject = normalizePath(p.path)
      if (normCwd === normProject || normCwd.startsWith(normProject + '/')) {
        if (!best || normProject.length > best.len) {
          best = {
            id: p.id,
            name: p.name,
            tabColor: colorSourceProject(p, projects).tabColor,
            len: normProject.length
          }
        }
      }
    }
    return best ? { id: best.id, name: best.name, tabColor: best.tabColor } : undefined
  }

  const handleRowClick = (event: AttentionEvent): void => {
    focusSessionTab(event.sessionId, event.providerId)
    const action = decideRowClickAction(event.kind, clickClearsWaiting)
    if (action === 'acknowledge') acknowledge(event.compositeId)
    else if (action === 'dismiss') dismiss(event.compositeId)
    setOpen(false)
  }

  const toggleClickMode = (): void => {
    updateSettings({ attentionClickClearsWaiting: !clickClearsWaiting })
  }

  return (
    <div ref={rootRef} className="relative no-drag">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-7 h-7 flex items-center justify-center rounded-md transition-colors"
        style={{
          color: open ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
          backgroundColor: open ? 'var(--dplex-bg-elev)' : 'transparent'
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
          e.currentTarget.style.color = 'var(--dplex-text)'
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.backgroundColor = 'transparent'
          if (!open) e.currentTarget.style.color = 'var(--dplex-text-muted)'
        }}
        title="Attention inbox"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center"
            style={{
              backgroundColor: 'var(--dplex-status-approval)',
              color: '#fff',
              boxShadow: '0 0 0 2px var(--dplex-bg-panel), 0 0 8px var(--dplex-status-approval)'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] overflow-y-auto rounded-xl z-50 dplex-scroll-autohide"
          style={{
            backgroundColor: 'var(--dplex-bg-elev)',
            border: '1px solid var(--dplex-border-strong)',
            boxShadow: 'var(--dplex-shadow-xl)'
          }}
        >
          <div
            className="flex items-center gap-2 px-3.5 py-2.5 sticky top-0 z-[1]"
            style={{
              borderBottom: '1px solid var(--dplex-border-subtle)',
              backgroundColor: 'var(--dplex-bg-elev)'
            }}
          >
            <span className="text-[12px] font-semibold" style={{ color: 'var(--dplex-text)' }}>
              Attention
            </span>
            {visible.length > 0 && (
              <span
                className="text-[10px] tabular-nums px-1.5 rounded-full"
                style={{
                  fontFamily: 'var(--dplex-font-mono)',
                  color: 'var(--dplex-text-dim)',
                  backgroundColor: 'var(--dplex-bg-elev-2)',
                  padding: '1px 6px'
                }}
              >
                {visible.length}
              </span>
            )}
            <button
              onClick={toggleClickMode}
              className="text-[10px] flex items-center gap-1 px-2 py-[2px] rounded-full transition-colors hover:bg-[var(--dplex-hover)] ml-2"
              style={
                clickClearsWaiting
                  ? {
                      color: 'var(--dplex-accent)',
                      border: '1px solid var(--dplex-accent-ring)',
                      backgroundColor: 'var(--dplex-accent-soft)'
                    }
                  : {
                      color: 'var(--dplex-text-muted)',
                      border: '1px solid var(--dplex-border)',
                      backgroundColor: 'transparent'
                    }
              }
              title={
                clickClearsWaiting
                  ? 'Clicking a row navigates and clears the notification. Click here to switch to view-only.'
                  : 'Clicking a row only navigates. Click here to also clear waiting notifications when you click them.'
              }
              aria-pressed={clickClearsWaiting}
              aria-label="Toggle: mark waiting notifications as seen on click"
            >
              {clickClearsWaiting ? <Check size={10} /> : <Eye size={10} />}
              {clickClearsWaiting ? 'Mark seen on click' : 'View only'}
            </button>
            <span className="flex-1" />
            {grouped.finished.length > 0 && (
              <button
                onClick={() => acknowledgeAll()}
                className="text-[10px] flex items-center gap-1 px-2 py-[2px] rounded hover:bg-[var(--dplex-hover)] transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                title="Acknowledge all finished"
              >
                <Check size={10} /> Clear finished
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="px-3 py-12 text-center" style={{ color: 'var(--dplex-text-dim)' }}>
              <div
                aria-hidden
                className="inline-flex items-center justify-center mb-3"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: 'var(--dplex-bg-elev-2)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text-faint)'
                }}
              >
                <Bell size={16} />
              </div>
              <div className="text-[12px]">Nothing needs your attention.</div>
              <div className="text-[11px] mt-1" style={{ color: 'var(--dplex-text-faint)' }}>
                Waiting and finished sessions will appear here.
              </div>
            </div>
          ) : (
            KIND_ORDER.map((kind) => {
              const items = grouped[kind]
              if (items.length === 0) return null
              return (
                <div key={kind}>
                  <div
                    className="px-3.5 pt-3 pb-1.5 flex items-center gap-2"
                    style={{ backgroundColor: 'var(--dplex-bg-elev)' }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: KIND_COLOR[kind] }}
                    />
                    <span
                      className="text-[10px] uppercase tracking-wider font-semibold flex-1"
                      style={{ color: 'var(--dplex-text-dim)', letterSpacing: '0.08em' }}
                    >
                      {KIND_LABEL[kind]}
                    </span>
                    <span
                      className="text-[10px] tabular-nums"
                      style={{
                        fontFamily: 'var(--dplex-font-mono)',
                        color: 'var(--dplex-text-faint)'
                      }}
                    >
                      {items.length}
                    </span>
                  </div>
                  {items.map((e) => {
                    const project = resolveProject(e)
                    return (
                      <div
                        key={e.compositeId + e.createdAt}
                        className="group flex items-center gap-2.5 px-3.5 py-2 cursor-pointer transition-colors"
                        onMouseEnter={(el) => {
                          el.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev-2)'
                        }}
                        onMouseLeave={(el) => {
                          el.currentTarget.style.backgroundColor = 'transparent'
                        }}
                        onClick={() => handleRowClick(e)}
                      >
                        {project ? (
                          <ProjectAvatar color={project.tabColor} name={project.name} size={28} />
                        ) : (
                          <span
                            aria-hidden
                            className="grid place-items-center flex-shrink-0"
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              backgroundColor: 'var(--dplex-bg-elev-2)',
                              border: '1px solid var(--dplex-border)',
                              color: 'var(--dplex-text-faint)',
                              fontSize: 11,
                              fontWeight: 700
                            }}
                          >
                            {e.displayName.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[12px] truncate flex-1"
                              style={{ color: 'var(--dplex-text)', fontWeight: 500 }}
                            >
                              {e.displayName}
                            </span>
                            <span
                              className="text-[10px] tabular-nums flex-shrink-0"
                              style={{
                                fontFamily: 'var(--dplex-font-mono)',
                                color: 'var(--dplex-text-dim)'
                              }}
                            >
                              {formatAge(e.createdAt)}
                            </span>
                          </div>
                          <div
                            className="text-[10.5px] flex items-center gap-1.5 mt-0.5"
                            style={{ color: 'var(--dplex-text-muted)' }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: KIND_COLOR[e.kind] }}
                            />
                            <span className="truncate">{e.providerId}</span>
                            {project && (
                              <>
                                <span style={{ color: 'var(--dplex-text-faint)' }}>·</span>
                                <span className="truncate">{project.name}</span>
                              </>
                            )}
                            {e.escalated && (
                              <span
                                className="px-1.5 rounded text-[9px] font-semibold uppercase tracking-wider ml-1"
                                style={{
                                  backgroundColor: 'rgba(245,158,11,0.15)',
                                  color: 'var(--dplex-status-approval)',
                                  letterSpacing: '0.05em'
                                }}
                              >
                                idle
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation()
                            dismiss(e.compositeId)
                          }}
                          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded transition-all flex-shrink-0"
                          style={{ color: 'var(--dplex-text-dim)' }}
                          onMouseEnter={(el) => {
                            el.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev-3)'
                            el.currentTarget.style.color = 'var(--dplex-text)'
                          }}
                          onMouseLeave={(el) => {
                            el.currentTarget.style.backgroundColor = 'transparent'
                            el.currentTarget.style.color = 'var(--dplex-text-dim)'
                          }}
                          title="Dismiss"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
