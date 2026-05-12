import { useState, useRef, useEffect } from 'react'
import { Bell, Check, Eye, X } from 'lucide-react'
import { useAttentionStore } from '../../stores/attentionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { decideRowClickAction } from './rowClickAction'
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
        className="relative w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--dplex-hover)] transition-colors"
        style={{ color: 'var(--dplex-text-muted)' }}
        title="Attention inbox"
      >
        <Bell size={14} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center"
            style={{
              backgroundColor: 'var(--dplex-status-approval)',
              color: 'white'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-[340px] max-h-[460px] overflow-y-auto rounded shadow-lg z-50"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            border: '1px solid var(--dplex-border)'
          }}
        >
          <div
            className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid var(--dplex-border)' }}
          >
            <span className="text-[11px] font-semibold" style={{ color: 'var(--dplex-text)' }}>
              Attention
            </span>
            <button
              onClick={toggleClickMode}
              className="text-[10px] flex items-center gap-1 px-2 py-[2px] rounded-full transition-colors hover:bg-[var(--dplex-hover)]"
              style={
                clickClearsWaiting
                  ? {
                      color: 'var(--dplex-accent)',
                      border: '1px solid var(--dplex-accent)',
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
                className="text-[10px] flex items-center gap-1 hover:opacity-80"
                style={{ color: 'var(--dplex-text-muted)' }}
                title="Acknowledge all finished"
              >
                <Check size={10} /> Clear finished
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div
              className="px-3 py-6 text-center text-[11px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              Nothing needs your attention.
            </div>
          ) : (
            KIND_ORDER.map((kind) => {
              const items = grouped[kind]
              if (items.length === 0) return null
              return (
                <div key={kind}>
                  <div
                    className="px-3 py-1 text-[9px] uppercase tracking-wider"
                    style={{
                      color: 'var(--dplex-text-muted)',
                      backgroundColor: 'var(--dplex-bg)'
                    }}
                  >
                    {KIND_LABEL[kind]} · {items.length}
                  </div>
                  {items.map((e) => (
                    <div
                      key={e.compositeId + e.createdAt}
                      className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--dplex-hover)]"
                      style={{ borderBottom: '1px solid var(--dplex-border)' }}
                      onClick={() => handleRowClick(e)}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: KIND_COLOR[e.kind] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[11px] truncate"
                          style={{ color: 'var(--dplex-text)' }}
                        >
                          {e.displayName}
                        </div>
                        <div
                          className="text-[10px] flex items-center gap-1.5"
                          style={{ color: 'var(--dplex-text-muted)' }}
                        >
                          <span>{e.providerId}</span>
                          <span>·</span>
                          <span>{formatAge(e.createdAt)}</span>
                          {e.escalated && (
                            <span
                              className="px-1 rounded text-[9px] font-semibold"
                              style={{
                                backgroundColor: 'var(--dplex-status-approval)',
                                color: 'white'
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
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--dplex-hover)]"
                        style={{ color: 'var(--dplex-text-muted)' }}
                        title="Dismiss"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
