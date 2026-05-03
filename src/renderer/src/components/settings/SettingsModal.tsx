import { useState, useEffect, useRef } from 'react'
import { X, Palette, Terminal, Bot, Keyboard, BellRing, GitBranch } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { getThemesByVariant, getTheme } from '../../services/themes'
import { applyThemeToAll } from '../../services/terminalRegistry'
import type { ShellInfo, AppSettings } from '../../types'
import { MOD, SHIFT } from '../../utils/shortcuts'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab =
  | 'appearance'
  | 'terminal'
  | 'ai-tools'
  | 'notifications'
  | 'worktrees'
  | 'shortcuts'

const SHORTCUTS: { category: string; items: { keys: string; description: string }[] }[] = [
  {
    category: 'General',
    items: [
      { keys: `${MOD}T`, description: 'New terminal' },
      { keys: `${MOD}W`, description: 'Close terminal' },
      { keys: `${MOD},`, description: 'Open settings' },
      { keys: `${MOD}B`, description: 'Toggle sidebar' },
      { keys: `${MOD}F`, description: 'Focus panel search' }
    ]
  },
  {
    category: 'Layout',
    items: [
      { keys: `${MOD}\\`, description: 'Split right' },
      { keys: `${MOD}${SHIFT}\\`, description: 'Split down' }
    ]
  },
  {
    category: 'Tabs',
    items: [
      { keys: `${MOD}1–9`, description: 'Switch to tab 1–9' },
      { keys: 'Drag tab', description: 'Reorder or move between groups' },
      { keys: 'Double-click tab', description: 'Rename terminal' }
    ]
  }
]

type SettingsTabGroup = { title: string; tabs: SettingsTab[] }

const TAB_GROUPS: SettingsTabGroup[] = [
  { title: 'General', tabs: ['appearance', 'shortcuts'] },
  { title: 'AI Tools', tabs: ['ai-tools', 'worktrees', 'notifications'] },
  { title: 'Terminal', tabs: ['terminal'] }
]

const TAB_HEADINGS: Record<SettingsTab, { title: string; description: string }> = {
  appearance: {
    title: 'Appearance',
    description: 'Pick a theme that matches your environment. Affects terminal and UI.'
  },
  terminal: {
    title: 'Terminal',
    description: 'Default shell and font for new terminals.'
  },
  'ai-tools': {
    title: 'AI Tools',
    description: 'Configure provider commands, defaults, and how sessions are surfaced.'
  },
  notifications: {
    title: 'Notifications',
    description: 'Bell + system alerts when sessions need your attention.'
  },
  worktrees: {
    title: 'Worktrees',
    description: 'Defaults applied when creating a new git worktree from a project.'
  },
  shortcuts: {
    title: 'Shortcuts',
    description: 'Keyboard shortcuts. These are not configurable yet.'
  }
}

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'ai-tools', label: 'AI Tools', icon: Bot },
  { id: 'notifications', label: 'Notifications', icon: BellRing },
  { id: 'worktrees', label: 'Worktrees', icon: GitBranch },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard }
]

function SettingItem({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-5 last:mb-0">
      <span className="block text-[11px] font-medium mb-0.5" style={{ color: 'var(--dplex-text)' }}>
        {label}
      </span>
      {description && (
        <p className="text-[10px] mb-2" style={{ color: 'var(--dplex-text-muted)' }}>
          {description}
        </p>
      )}
      {children}
    </div>
  )
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps): React.JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [providers, setProviders] = useState<{ id: string; name: string; command: string }[]>([])
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const { dark: darkThemes, light: lightThemes } = getThemesByVariant()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isOpen) {
      window.dplex.app.getAvailableShells().then(setShells)
      window.dplex.sessions.getProviders().then(setProviders)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ section?: string }>).detail
      if (detail?.section === 'worktrees') {
        setActiveTab('worktrees')
      }
    }
    window.addEventListener('dplex:open-settings', handler)
    return () => window.removeEventListener('dplex:open-settings', handler)
  }, [])

  // Clear debounce timer on unmount to prevent stale writes
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  if (!isOpen) return null

  const applyNow = (partial: Partial<AppSettings>): void => {
    updateSettings(partial)
    if (partial.theme) applyThemeToAll(partial.theme)
  }

  const applyDebounced = (partial: Partial<AppSettings>): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Apply to UI immediately via store
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, ...partial } }))
    // Debounce the persist
    debounceRef.current = setTimeout(() => {
      updateSettings(partial).then(() => {
        if (partial.sessionMaxAgeDays !== undefined) {
          refreshSessions()
        }
      })
    }, 400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-2xl shadow-2xl flex flex-col"
        style={{
          width: 900,
          height: 560,
          backgroundColor: 'var(--dplex-bg-panel)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)'
        }}
      >
        <div className="flex flex-1 min-h-0 overflow-hidden rounded-2xl">
          {/* Left rail — grouped navigation. Mirrors the preview's modal-side. */}
          <div
            className="w-[220px] flex-shrink-0 px-3 py-4 flex flex-col gap-0.5"
            style={{
              backgroundColor: 'var(--dplex-bg-alt)',
              borderRight: '1px solid var(--dplex-border)'
            }}
          >
            {TAB_GROUPS.map((group, gi) => (
              <div key={group.title} className={gi > 0 ? 'mt-3' : ''}>
                <h3
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] px-2.5 mb-1.5"
                  style={{ color: 'var(--dplex-text-dim)' }}
                >
                  {group.title}
                </h3>
                {group.tabs.map((tabId) => {
                  const meta = TABS.find((t) => t.id === tabId)
                  if (!meta) return null
                  const Icon = meta.icon
                  const isActive = activeTab === tabId
                  return (
                    <button
                      key={tabId}
                      onClick={() => setActiveTab(tabId)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors text-left"
                      style={{
                        backgroundColor: isActive ? 'var(--dplex-accent-soft)' : 'transparent',
                        color: isActive ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)',
                        boxShadow: isActive ? 'inset 0 0 0 1px rgba(123,162,255,0.25)' : undefined
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
                          e.currentTarget.style.color = 'var(--dplex-text)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          e.currentTarget.style.color = 'var(--dplex-text-muted)'
                        }
                      }}
                    >
                      <Icon size={15} />
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Right pane — head, body, foot. */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div
              className="flex items-start justify-between px-6 py-4 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--dplex-border)' }}
            >
              <div>
                <h2
                  className="text-[16px] font-semibold m-0"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  {TAB_HEADINGS[activeTab].title}
                </h2>
                <p className="text-[12.5px] mt-1 m-0" style={{ color: 'var(--dplex-text-muted)' }}>
                  {TAB_HEADINGS[activeTab].description}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 hover:bg-[var(--dplex-hover)] rounded-md transition-colors"
                style={{ color: 'var(--dplex-text-muted)' }}
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 px-6 py-5 overflow-y-auto">
              {activeTab === 'appearance' && (
                <SettingItem label="Theme">
                  <h4
                    className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--dplex-text-muted)' }}
                  >
                    Dark
                  </h4>
                  <div className="grid grid-cols-4 gap-2.5 mb-4">
                    {darkThemes.map((t) => {
                      const theme = getTheme(t.id)
                      const isSelected = settings.theme === t.id
                      return (
                        <button
                          key={t.id}
                          onClick={() => applyNow({ theme: t.id })}
                          className="flex flex-col p-2.5 rounded-lg transition-colors text-left"
                          style={{
                            backgroundColor: 'var(--dplex-bg-alt)',
                            border: '1px solid',
                            borderColor: isSelected ? 'var(--dplex-accent)' : 'var(--dplex-border)',
                            boxShadow: isSelected ? '0 0 0 3px var(--dplex-accent-soft)' : undefined
                          }}
                        >
                          <div
                            className="h-12 rounded flex overflow-hidden mb-2"
                            style={{ border: '1px solid var(--dplex-border)' }}
                          >
                            <span className="flex-1" style={{ backgroundColor: theme.ui.bg }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.bgAlt }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.accent }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.text }} />
                          </div>
                          <span
                            className="text-[12px] font-medium"
                            style={{ color: 'var(--dplex-text)' }}
                          >
                            {t.name}
                          </span>
                          <span
                            className="text-[11px] mt-0.5"
                            style={{ color: 'var(--dplex-text-muted)' }}
                          >
                            Dark
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <h4
                    className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--dplex-text-muted)' }}
                  >
                    Light
                  </h4>
                  <div className="grid grid-cols-4 gap-2.5">
                    {lightThemes.map((t) => {
                      const theme = getTheme(t.id)
                      const isSelected = settings.theme === t.id
                      return (
                        <button
                          key={t.id}
                          onClick={() => applyNow({ theme: t.id })}
                          className="flex flex-col p-2.5 rounded-lg transition-colors text-left"
                          style={{
                            backgroundColor: 'var(--dplex-bg-alt)',
                            border: '1px solid',
                            borderColor: isSelected ? 'var(--dplex-accent)' : 'var(--dplex-border)',
                            boxShadow: isSelected ? '0 0 0 3px var(--dplex-accent-soft)' : undefined
                          }}
                        >
                          <div
                            className="h-12 rounded flex overflow-hidden mb-2"
                            style={{ border: '1px solid var(--dplex-border)' }}
                          >
                            <span className="flex-1" style={{ backgroundColor: theme.ui.bg }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.bgAlt }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.accent }} />
                            <span className="flex-1" style={{ backgroundColor: theme.ui.text }} />
                          </div>
                          <span
                            className="text-[12px] font-medium"
                            style={{ color: 'var(--dplex-text)' }}
                          >
                            {t.name}
                          </span>
                          <span
                            className="text-[11px] mt-0.5"
                            style={{ color: 'var(--dplex-text-muted)' }}
                          >
                            Light
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </SettingItem>
              )}

              {activeTab === 'terminal' && (
                <>
                  <SettingItem
                    label="Default Shell"
                    description="The shell used when opening new terminals. Override per-tab with the dropdown next to the + button."
                  >
                    <select
                      value={settings.defaultShell}
                      onChange={(e) => applyNow({ defaultShell: e.target.value })}
                      className="w-full rounded px-3 py-1.5 text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    >
                      <option value="">System default</option>
                      {shells.map((s) => (
                        <option key={s.path} value={s.path}>
                          {s.name} ({s.path})
                        </option>
                      ))}
                    </select>
                  </SettingItem>

                  <SettingItem
                    label="Font Size"
                    description={`Controls the terminal font size in pixels. Currently ${settings.fontSize}px.`}
                  >
                    <input
                      type="range"
                      min={10}
                      max={24}
                      value={settings.fontSize}
                      onChange={(e) => applyDebounced({ fontSize: Number(e.target.value) })}
                      className="w-full accent-[var(--dplex-accent)]"
                    />
                  </SettingItem>

                  <SettingItem
                    label="Font Family"
                    description="Controls the terminal font family. Use a monospace font for best results."
                  >
                    <input
                      type="text"
                      value={settings.fontFamily}
                      onChange={(e) => applyDebounced({ fontFamily: e.target.value })}
                      className="w-full rounded px-3 py-1.5 text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    />
                  </SettingItem>
                </>
              )}

              {activeTab === 'ai-tools' && (
                <>
                  <SettingItem
                    label="Default AI Tool"
                    description="The AI CLI tool used for session discovery and integration."
                  >
                    <select
                      value={settings.defaultAITool}
                      onChange={(e) => applyNow({ defaultAITool: e.target.value })}
                      className="w-full rounded px-3 py-1.5 text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </SettingItem>

                  <SettingItem
                    label="Session Max Age"
                    description={`Sessions older than this are hidden from the sessions panel. Currently ${settings.sessionMaxAgeDays} day${settings.sessionMaxAgeDays === 1 ? '' : 's'}.`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={15}
                        value={settings.sessionMaxAgeDays}
                        onChange={(e) =>
                          applyDebounced({ sessionMaxAgeDays: Number(e.target.value) })
                        }
                        className="flex-1 accent-[var(--dplex-accent)]"
                      />
                      <input
                        type="number"
                        min={1}
                        max={15}
                        value={settings.sessionMaxAgeDays}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n) && n >= 1) {
                            applyDebounced({ sessionMaxAgeDays: Math.min(15, Math.floor(n)) })
                          }
                        }}
                        className="w-16 rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        days
                      </span>
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Hide empty sessions"
                    description="Hide idle sessions that have no messages yet. Active sessions are always shown."
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.hideEmptySessions}
                        onChange={(e) => applyNow({ hideEmptySessions: e.target.checked })}
                        className="accent-[var(--dplex-accent)]"
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                        Hide sessions with no messages
                      </span>
                    </label>
                  </SettingItem>
                </>
              )}

              {activeTab === 'notifications' && (
                <>
                  <SettingItem
                    label="Enable notifications"
                    description="Master toggle for desktop notifications and the attention inbox badge."
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notificationsEnabled}
                        onChange={(e) => applyNow({ notificationsEnabled: e.target.checked })}
                        className="accent-[var(--dplex-accent)]"
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                        Show desktop notifications
                      </span>
                    </label>
                  </SettingItem>

                  <SettingItem
                    label="Notify me about"
                    description="Pick which kinds of events raise a desktop notification."
                  >
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.notifyOnApproval}
                          onChange={(e) => applyNow({ notifyOnApproval: e.target.checked })}
                          className="accent-[var(--dplex-accent)]"
                        />
                        <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                          Waiting for approval
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.notifyOnInput}
                          onChange={(e) => applyNow({ notifyOnInput: e.target.checked })}
                          className="accent-[var(--dplex-accent)]"
                        />
                        <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                          Waiting for input
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.notifyOnFinished}
                          onChange={(e) => applyNow({ notifyOnFinished: e.target.checked })}
                          className="accent-[var(--dplex-accent)]"
                        />
                        <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                          Session finished (became idle)
                        </span>
                      </label>
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Only when unfocused"
                    description="Suppress notifications when the DPlex window is already focused."
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notifyOnlyWhenUnfocused}
                        onChange={(e) => applyNow({ notifyOnlyWhenUnfocused: e.target.checked })}
                        className="accent-[var(--dplex-accent)]"
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                        Only notify when window is not focused
                      </span>
                    </label>
                  </SettingItem>

                  <SettingItem
                    label="Play sound"
                    description="Use the OS default sound when a notification fires."
                  >
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.notificationSound}
                        onChange={(e) => applyNow({ notificationSound: e.target.checked })}
                        className="accent-[var(--dplex-accent)]"
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                        Enable notification sound
                      </span>
                    </label>
                  </SettingItem>

                  <SettingItem
                    label="Do not disturb"
                    description="Quiet-hours window (24-hour HH:MM). Leave both empty to disable. Supports overnight spans (e.g. 22:00 → 08:00)."
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={settings.dndFrom ?? ''}
                        onChange={(e) =>
                          applyNow({ dndFrom: e.target.value.trim() ? e.target.value : null })
                        }
                        className="rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        to
                      </span>
                      <input
                        type="time"
                        value={settings.dndTo ?? ''}
                        onChange={(e) =>
                          applyNow({ dndTo: e.target.value.trim() ? e.target.value : null })
                        }
                        className="rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Notification cooldown"
                    description={`Minimum time between notifications for the same session. Currently ${settings.notificationCooldownSeconds} second${settings.notificationCooldownSeconds === 1 ? '' : 's'}. Set to 0 to disable.`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={300}
                        step={5}
                        value={settings.notificationCooldownSeconds}
                        onChange={(e) =>
                          applyDebounced({ notificationCooldownSeconds: Number(e.target.value) })
                        }
                        className="flex-1 accent-[var(--dplex-accent)]"
                      />
                      <input
                        type="number"
                        min={0}
                        max={3600}
                        value={settings.notificationCooldownSeconds}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n) && n >= 0) {
                            applyDebounced({
                              notificationCooldownSeconds: Math.min(3600, Math.floor(n))
                            })
                          }
                        }}
                        className="w-16 rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        sec
                      </span>
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Idle escalation"
                    description={`Re-notify when a waiting session goes unanswered for this long. Currently ${settings.idleTooLongMinutes} minute${settings.idleTooLongMinutes === 1 ? '' : 's'}.`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={30}
                        value={settings.idleTooLongMinutes}
                        onChange={(e) =>
                          applyDebounced({ idleTooLongMinutes: Number(e.target.value) })
                        }
                        className="flex-1 accent-[var(--dplex-accent)]"
                      />
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={settings.idleTooLongMinutes}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n) && n >= 1) {
                            applyDebounced({ idleTooLongMinutes: Math.min(180, Math.floor(n)) })
                          }
                        }}
                        className="w-16 rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        min
                      </span>
                    </div>
                  </SettingItem>
                </>
              )}

              {activeTab === 'worktrees' && (
                <>
                  <SettingItem
                    label="Location pattern"
                    description="Where new worktrees are created. Supports {project} and {branch} placeholders."
                  >
                    <input
                      type="text"
                      value={settings.worktreeDefaults.locationPattern}
                      onChange={(e) =>
                        applyDebounced({
                          worktreeDefaults: {
                            ...settings.worktreeDefaults,
                            locationPattern: e.target.value
                          }
                        })
                      }
                      placeholder="../{project}-worktrees/{branch}"
                      className="w-full rounded px-2 py-1 text-xs font-mono outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Env files to copy"
                    description="Comma-separated relative paths (supports trailing wildcards like .env.*.local)."
                  >
                    <input
                      type="text"
                      value={settings.worktreeDefaults.envFiles.join(', ')}
                      onChange={(e) =>
                        applyDebounced({
                          worktreeDefaults: {
                            ...settings.worktreeDefaults,
                            envFiles: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                          }
                        })
                      }
                      placeholder=".env.local, .env.*.local"
                      className="w-full rounded px-2 py-1 text-xs font-mono outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Setup script"
                    description="Shell script to run after creating a worktree (e.g. npm install)."
                  >
                    <textarea
                      value={settings.worktreeDefaults.setupScript}
                      onChange={(e) =>
                        applyDebounced({
                          worktreeDefaults: {
                            ...settings.worktreeDefaults,
                            setupScript: e.target.value
                          }
                        })
                      }
                      rows={3}
                      placeholder="npm install"
                      className="w-full rounded px-2 py-1 text-xs font-mono outline-none resize-y"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    />
                  </SettingItem>

                  <SettingItem
                    label="After creation"
                    description="What to do once a worktree is ready."
                  >
                    <select
                      value={settings.worktreeDefaults.afterCreate}
                      onChange={(e) =>
                        applyNow({
                          worktreeDefaults: {
                            ...settings.worktreeDefaults,
                            afterCreate: e.target.value as 'session' | 'terminal' | 'none'
                          }
                        })
                      }
                      className="w-full rounded px-2 py-1 text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--dplex-bg-alt)',
                        border: '1px solid var(--dplex-border)',
                        color: 'var(--dplex-text)'
                      }}
                    >
                      <option value="session">Start AI session</option>
                      <option value="terminal">Open terminal</option>
                      <option value="none">Do nothing</option>
                    </select>
                  </SettingItem>
                </>
              )}

              {activeTab === 'shortcuts' && (
                <div className="space-y-4">
                  {SHORTCUTS.map((group) => (
                    <div key={group.category}>
                      <h4
                        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                        style={{ color: 'var(--dplex-accent)' }}
                      >
                        {group.category}
                      </h4>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <div
                            key={item.keys}
                            className="flex items-center justify-between py-1.5 px-2 rounded"
                            style={{ backgroundColor: 'var(--dplex-bg-alt)' }}
                          >
                            <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>
                              {item.description}
                            </span>
                            <kbd
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: 'var(--dplex-bg)',
                                border: '1px solid var(--dplex-border)',
                                color: 'var(--dplex-text-muted)'
                              }}
                            >
                              {item.keys}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — flush with the bottom of the right pane. */}
            <div
              className="flex items-center justify-between flex-shrink-0 px-6 py-3"
              style={{
                borderTop: '1px solid var(--dplex-border)',
                backgroundColor: 'var(--dplex-bg-alt)'
              }}
            >
              <span className="text-[12px]" style={{ color: 'var(--dplex-text-dim)' }}>
                Changes apply immediately
              </span>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg transition-transform"
                style={{
                  background: 'linear-gradient(180deg, var(--dplex-accent), var(--dplex-accent-2))',
                  color: '#fff',
                  border: 0,
                  boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 12px rgba(123,162,255,0.4)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow =
                    '0 1px 0 rgba(255,255,255,0.15) inset, 0 6px 16px rgba(123,162,255,0.5)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow =
                    '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 12px rgba(123,162,255,0.4)'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
