import { useState, useEffect, useRef } from 'react'
import {
  X,
  Palette,
  Terminal,
  Bot,
  Keyboard,
  BellRing,
  GitBranch,
  Info,
  FileText
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUpdateStore } from '../../stores/updateStore'
import { getThemesByVariant, getTheme } from '../../services/themes'
import { applyThemeToAll } from '../../services/terminalRegistry'
import { Switch } from '../common/Switch'
import type { ShellInfo, AppSettings } from '../../types'
import { MOD, SHIFT, isMac } from '../../utils/shortcuts'
import { timeAgo } from '../../utils/timeAgo'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab =
  | 'appearance'
  | 'terminal'
  | 'editor'
  | 'ai-tools'
  | 'notifications'
  | 'worktrees'
  | 'shortcuts'
  | 'about'

const SHORTCUTS: { category: string; items: { keys: string; description: string }[] }[] = [
  {
    category: 'General',
    items: [
      { keys: `${MOD}T`, description: 'New terminal' },
      { keys: `${MOD}W`, description: 'Close tab' },
      { keys: `${MOD}S`, description: 'Save file (editor)' },
      { keys: `${MOD}${SHIFT}E`, description: 'Open Explorer side panel' },
      { keys: `${MOD},`, description: 'Open settings' },
      { keys: `${MOD}B`, description: 'Toggle sidebar' },
      { keys: `${MOD}F`, description: 'Focus panel search' },
      { keys: `${MOD}${SHIFT}F`, description: 'Open Search side panel' },
      {
        keys: `${MOD}P`,
        description: 'Global search — projects, sessions, tabs, settings (try #tag)'
      },
      { keys: `${MOD}${SHIFT}P`, description: 'Run a command' }
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
  { title: 'General', tabs: ['appearance', 'shortcuts', 'about'] },
  { title: 'AI Tools', tabs: ['ai-tools', 'worktrees', 'notifications'] },
  { title: 'Terminal', tabs: ['terminal'] },
  { title: 'Editor', tabs: ['editor'] }
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
  editor: {
    title: 'Editor',
    description: 'How the file editor saves your changes.'
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
  },
  about: {
    title: 'About',
    description: 'Version info and update controls.'
  }
}

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'editor', label: 'Editor', icon: FileText },
  { id: 'ai-tools', label: 'AI Tools', icon: Bot },
  { id: 'notifications', label: 'Notifications', icon: BellRing },
  { id: 'worktrees', label: 'Worktrees', icon: GitBranch },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info }
]

function SettingItem({
  label,
  description,
  children,
  settingId
}: {
  label: string
  description?: string
  children: React.ReactNode
  settingId?: string
}): React.JSX.Element {
  return (
    <div className="mb-5 last:mb-0" data-setting-id={settingId}>
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

/**
 * Settings-row toggle. Renders the supplied label on the left and a
 * themed Switch on the right, separated by a stretching spacer so the
 * switch always sits at the right edge of the row (matches the v2
 * settings mockup — Section 23 / 25 / 26).
 */
function ToggleRow({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className="flex items-center gap-3 py-1"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <span
        className="text-[11px] flex-1"
        style={{ color: 'var(--dplex-text)', opacity: disabled ? 0.5 : 1 }}
      >
        {label}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </label>
  )
}

/**
 * Compact theme swatch used in the Appearance picker. Shows a small
 * bg / bgAlt / accent / text preview strip and the theme name — deliberately
 * short so several rows of themes fit without pushing the settings below the
 * fold. Selected state uses the accent border + soft ring.
 */
function ThemeTile({
  themeId,
  name,
  selected,
  onSelect
}: {
  themeId: string
  name: string
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const theme = getTheme(themeId)
  return (
    <button
      onClick={onSelect}
      title={name}
      className="flex flex-col p-1.5 rounded-lg transition-colors text-left"
      style={{
        backgroundColor: 'var(--dplex-bg-alt)',
        border: '1px solid',
        borderColor: selected ? 'var(--dplex-accent)' : 'var(--dplex-border)',
        boxShadow: selected ? '0 0 0 2px var(--dplex-accent-soft)' : undefined
      }}
    >
      <div
        className="h-7 rounded-md flex overflow-hidden mb-1.5"
        style={{ border: '1px solid var(--dplex-border)' }}
      >
        <span className="flex-1" style={{ backgroundColor: theme.ui.bg }} />
        <span className="flex-1" style={{ backgroundColor: theme.ui.bgAlt }} />
        <span className="flex-1" style={{ backgroundColor: theme.ui.accent }} />
        <span className="flex-1" style={{ backgroundColor: theme.ui.text }} />
      </div>
      <span
        className="text-[11px] font-medium truncate px-0.5"
        style={{ color: 'var(--dplex-text)' }}
      >
        {name}
      </span>
    </button>
  )
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps): React.JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [providers, setProviders] = useState<{ id: string; name: string; command: string }[]>([])
  const [platform, setPlatform] = useState<string>('')
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const { dark: darkThemes, light: lightThemes } = getThemesByVariant()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Accumulator for `applyDebounced`: pending patches are merged so a
  // user toggling multiple debounced controls within the debounce window
  // doesn't lose intermediate keys when the timer flushes.
  const pendingPatchRef = useRef<Partial<AppSettings>>({})

  useEffect(() => {
    if (isOpen) {
      window.dplex.app.getAvailableShells().then(setShells)
      window.dplex.sessions.getProviders().then(setProviders)
      window.dplex.app.getPlatform().then(setPlatform)
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
      const detail = (e as CustomEvent<{ section?: string; highlightId?: string }>).detail
      const section = detail?.section
      if (section && TABS.some((t) => t.id === section)) {
        setActiveTab(section as SettingsTab)
      }
      const highlightId = detail?.highlightId
      if (highlightId) {
        // Defer until after the tab switch + render commit so the target row
        // is mounted before we try to find it.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const root = document.querySelector('[data-testid="settings-modal"]')
            const node = (root ?? document).querySelector(
              `[data-setting-id="${CSS.escape(highlightId)}"]`
            ) as HTMLElement | null
            if (!node) return
            node.scrollIntoView({ block: 'center', behavior: 'smooth' })
            node.classList.remove('dplex-setting-pulse')
            // Force reflow so re-adding the class restarts the animation.

            void node.offsetWidth
            node.classList.add('dplex-setting-pulse')
            const onEnd = (): void => {
              node.classList.remove('dplex-setting-pulse')
              node.removeEventListener('animationend', onEnd)
            }
            node.addEventListener('animationend', onEnd)
          })
        })
      }
    }
    window.addEventListener('dplex:open-settings', handler)
    return () => window.removeEventListener('dplex:open-settings', handler)
  }, [])

  // Flush any pending debounced patch on unmount so closing the modal
  // mid-debounce doesn't silently lose the user's changes. We persist
  // outside of React's render cycle (the component is gone), but
  // `updateSettings` only touches the store + IPC — both safe here.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const pending = pendingPatchRef.current
      if (Object.keys(pending).length > 0) {
        pendingPatchRef.current = {}
        void updateSettings(pending)
      }
    }
  }, [updateSettings])

  if (!isOpen) return null

  const applyNow = (partial: Partial<AppSettings>): void => {
    updateSettings(partial)
    if (partial.theme) applyThemeToAll(partial.theme)
  }

  const applyDebounced = (partial: Partial<AppSettings>): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Apply to UI immediately via store
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, ...partial } }))
    // Merge into the pending patch so a flush picks up every key the
    // user touched during the debounce window — not just the last one.
    pendingPatchRef.current = { ...pendingPatchRef.current, ...partial }
    // Debounce the persist
    debounceRef.current = setTimeout(() => {
      const merged = pendingPatchRef.current
      pendingPatchRef.current = {}
      debounceRef.current = null
      updateSettings(merged).then(() => {
        if (merged.sessionMaxAgeDays !== undefined) {
          refreshSessions()
        }
      })
    }, 400)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="settings-modal"
      style={{ backgroundColor: 'rgba(10,10,12,0.65)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl flex flex-col"
        style={{
          width: 900,
          height: 560,
          backgroundColor: 'var(--dplex-bg-panel)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: 'var(--dplex-shadow-xl), inset 0 1px 0 rgba(255,255,255,0.04)'
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
                        boxShadow: isActive ? 'inset 0 0 0 1px var(--dplex-accent-ring)' : undefined
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
                <SettingItem label="Theme" settingId="theme">
                  <h4
                    className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--dplex-text-muted)' }}
                  >
                    Dark
                  </h4>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {darkThemes.map((t) => (
                      <ThemeTile
                        key={t.id}
                        themeId={t.id}
                        name={t.name}
                        selected={settings.theme === t.id}
                        onSelect={() => applyNow({ theme: t.id })}
                      />
                    ))}
                  </div>
                  <h4
                    className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--dplex-text-muted)' }}
                  >
                    Light
                  </h4>
                  <div className="grid grid-cols-4 gap-2">
                    {lightThemes.map((t) => (
                      <ThemeTile
                        key={t.id}
                        themeId={t.id}
                        name={t.name}
                        selected={settings.theme === t.id}
                        onSelect={() => applyNow({ theme: t.id })}
                      />
                    ))}
                  </div>
                </SettingItem>
              )}

              {activeTab === 'appearance' && (
                <SettingItem label="Tab Color" settingId="tab-color-content">
                  <ToggleRow
                    label="Apply tab color to the tab's header and content"
                    checked={settings.applyTabColorToContent}
                    onChange={(v) => applyNow({ applyTabColorToContent: v })}
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--dplex-text-muted)' }}>
                    When off, a colored tab still shows its color on the tab itself, but its
                    breadcrumb header (project · path) and content keep the theme&apos;s default
                    background.
                  </p>
                </SettingItem>
              )}

              {activeTab === 'terminal' && (
                <>
                  <SettingItem
                    label="Default Shell"
                    settingId="default-shell"
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
                    settingId="font-size"
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
                    settingId="font-family"
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

                  {isMac && (
                    <SettingItem
                      label="Option key as Alt"
                      settingId="mac-option-is-meta"
                      description={
                        'Send the ⌥ Option key to the terminal as Alt (Meta). Turn this off ' +
                        'to let macOS compose characters with Option — required to type ' +
                        '@ # [ ] { } \\ | on international keyboard layouts. Word-wise ' +
                        'navigation with ⌥+←/→ and ⌥+⌫ keeps working either way.'
                      }
                    >
                      <ToggleRow
                        label="Send ⌥ Option as Alt to the shell"
                        checked={settings.macOptionIsMeta}
                        onChange={(v) => applyNow({ macOptionIsMeta: v })}
                      />
                    </SettingItem>
                  )}

                  <SettingItem
                    label="Copy on selection"
                    settingId="copy-on-selection"
                    description={
                      'Automatically copy text to the clipboard as soon as you select it ' +
                      'with the mouse. Regardless of this setting you can always copy with ' +
                      (isMac ? '⌘C' : 'Ctrl+C (with a selection) or Ctrl+Shift+C') +
                      ', paste with ' +
                      (isMac ? '⌘V' : 'Ctrl+Shift+V') +
                      ', or right-click to copy the selection / paste when nothing is selected.'
                    }
                  >
                    <ToggleRow
                      label="Copy selected text to the clipboard automatically"
                      checked={settings.copyOnSelection}
                      onChange={(v) => applyNow({ copyOnSelection: v })}
                    />
                  </SettingItem>
                </>
              )}

              {activeTab === 'editor' && (
                <SettingItem
                  label="Auto Save"
                  settingId="editor-auto-save"
                  description="When editing files in the explorer, choose whether changes are saved automatically as you type, or only when you press the save shortcut."
                >
                  <select
                    value={settings.editorAutoSave}
                    onChange={(e) =>
                      applyNow({ editorAutoSave: e.target.value as AppSettings['editorAutoSave'] })
                    }
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{
                      backgroundColor: 'var(--dplex-bg-alt)',
                      border: '1px solid var(--dplex-border)',
                      color: 'var(--dplex-text)'
                    }}
                  >
                    <option value="manual">Manual ({MOD}S to save)</option>
                    <option value="onChange">On change (auto-save as you type)</option>
                  </select>
                </SettingItem>
              )}

              {activeTab === 'ai-tools' && (
                <>
                  <SettingItem
                    label="Default AI Tool"
                    settingId="default-ai-tool"
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
                    settingId="session-max-age"
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
                    label="Watcher Debounce (advanced)"
                    settingId="watcher-debounce"
                    description={
                      settings.watcherDebounceMs == null
                        ? `Higher values reduce CPU on noisy filesystems (e.g. Windows + AV) at the cost of slightly slower live status updates. Leave blank to use the platform default (${platform === 'win32' ? '1000' : '300'} ms).`
                        : `Currently ${settings.watcherDebounceMs} ms. Leave blank to use the platform default (${platform === 'win32' ? '1000' : '300'} ms).`
                    }
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={50}
                        max={10000}
                        step={50}
                        placeholder={platform === 'win32' ? '1000' : '300'}
                        value={settings.watcherDebounceMs ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value.trim()
                          if (raw === '') {
                            applyDebounced({ watcherDebounceMs: null })
                            return
                          }
                          const n = Number(raw)
                          if (Number.isFinite(n) && n > 0) {
                            applyDebounced({
                              watcherDebounceMs: Math.max(50, Math.min(10000, Math.floor(n)))
                            })
                          }
                        }}
                        className="w-24 rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)'
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        ms
                      </span>
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Hide empty sessions"
                    settingId="hide-empty-sessions"
                    description="Hide idle sessions that have no messages yet. Active sessions are always shown."
                  >
                    <ToggleRow
                      label="Hide sessions with no messages"
                      checked={settings.hideEmptySessions}
                      onChange={(v) => applyNow({ hideEmptySessions: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Recent sessions in projects"
                    settingId="recent-sessions-in-projects"
                    description="Show a slim list of recent (idle) sessions inside each expanded project so you can resume them without leaving the panel."
                  >
                    <ToggleRow
                      label="Show recent sessions per project"
                      checked={settings.showRecentSessionsInProject}
                      onChange={(v) => applyNow({ showRecentSessionsInProject: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Recent sessions count"
                    settingId="recent-sessions-count"
                    description={`How many recent sessions to surface per project / worktree. Currently ${settings.recentSessionsCount}.`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={settings.recentSessionsCount}
                        disabled={!settings.showRecentSessionsInProject}
                        onChange={(e) =>
                          applyDebounced({ recentSessionsCount: Number(e.target.value) })
                        }
                        className="flex-1 accent-[var(--dplex-accent)]"
                        style={{
                          opacity: settings.showRecentSessionsInProject ? 1 : 0.5
                        }}
                      />
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={settings.recentSessionsCount}
                        disabled={!settings.showRecentSessionsInProject}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (Number.isFinite(n) && n >= 1) {
                            applyDebounced({
                              recentSessionsCount: Math.min(5, Math.max(1, Math.floor(n)))
                            })
                          }
                        }}
                        className="w-16 rounded px-2 py-1 text-xs outline-none"
                        style={{
                          backgroundColor: 'var(--dplex-bg-alt)',
                          border: '1px solid var(--dplex-border)',
                          color: 'var(--dplex-text)',
                          opacity: settings.showRecentSessionsInProject ? 1 : 0.5
                        }}
                      />
                      <span className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
                        sessions
                      </span>
                    </div>
                  </SettingItem>
                </>
              )}

              {activeTab === 'notifications' && (
                <>
                  <SettingItem
                    label="Enable notifications"
                    settingId="notifications-enabled"
                    description="Master toggle for desktop notifications and the attention inbox badge."
                  >
                    <ToggleRow
                      label="Show desktop notifications"
                      checked={settings.notificationsEnabled}
                      onChange={(v) => applyNow({ notificationsEnabled: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Notify me about"
                    settingId="notify-events"
                    description="Pick which kinds of events raise a desktop notification."
                  >
                    <div className="space-y-1">
                      <ToggleRow
                        label="Waiting for approval"
                        checked={settings.notifyOnApproval}
                        onChange={(v) => applyNow({ notifyOnApproval: v })}
                      />
                      <ToggleRow
                        label="Waiting for input"
                        checked={settings.notifyOnInput}
                        onChange={(v) => applyNow({ notifyOnInput: v })}
                      />
                      <ToggleRow
                        label="Session finished (became idle)"
                        checked={settings.notifyOnFinished}
                        onChange={(v) => applyNow({ notifyOnFinished: v })}
                      />
                    </div>
                  </SettingItem>

                  <SettingItem
                    label="Only when unfocused"
                    settingId="notify-only-unfocused"
                    description="Suppress notifications when the DPlex window is already focused."
                  >
                    <ToggleRow
                      label="Only notify when window is not focused"
                      checked={settings.notifyOnlyWhenUnfocused}
                      onChange={(v) => applyNow({ notifyOnlyWhenUnfocused: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Mark seen on click"
                    settingId="notify-click-clears-waiting"
                    description="When on, clicking a row in the attention bell will navigate to the tab and clear the notification. The bell will re-surface the event if the session keeps waiting after a state change or stays idle past the escalation threshold. You can also toggle this mode inline from the bell dropdown header."
                  >
                    <ToggleRow
                      label="Mark waiting notifications as seen when I click them"
                      checked={settings.attentionClickClearsWaiting}
                      onChange={(v) => applyNow({ attentionClickClearsWaiting: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Play sound"
                    settingId="notify-sound"
                    description="Use the OS default sound when a notification fires."
                  >
                    <ToggleRow
                      label="Enable notification sound"
                      checked={settings.notificationSound}
                      onChange={(v) => applyNow({ notificationSound: v })}
                    />
                  </SettingItem>

                  <SettingItem
                    label="Do not disturb"
                    settingId="do-not-disturb"
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
                    settingId="notify-cooldown"
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
                    settingId="idle-escalation"
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
                    settingId="worktree-location-pattern"
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
                    settingId="worktree-env-files"
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
                    settingId="worktree-setup-script"
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
                    settingId="worktree-after-create"
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

              {activeTab === 'about' && <AboutPanel />}
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
                  boxShadow:
                    '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 12px var(--dplex-accent-glow)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow =
                    '0 1px 0 rgba(255,255,255,0.15) inset, 0 8px 20px var(--dplex-accent-glow)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow =
                    '0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 12px var(--dplex-accent-glow)'
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

/**
 * About tab — version info, platform, and update controls. Reads
 * everything from the renderer-side `useUpdateStore` so the panel
 * stays in sync with the global banner.
 */
function AboutPanel(): React.JSX.Element {
  const state = useUpdateStore((s) => s.state)
  const check = useUpdateStore((s) => s.check)
  const install = useUpdateStore((s) => s.install)
  const openDownload = useUpdateStore((s) => s.openDownload)
  const [version, setVersion] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')

  useEffect(() => {
    void window.dplex.app.getVersion().then(setVersion)
    void window.dplex.app.getPlatform().then(setPlatform)
  }, [])

  const status = state?.status ?? 'idle'
  const statusLabel = (() => {
    if (state?.installMode === 'unsupported') {
      return 'Auto-update is unavailable in development builds.'
    }
    switch (status) {
      case 'idle':
        return 'Click below to check for updates.'
      case 'checking':
        return 'Checking for updates…'
      case 'up-to-date':
        return "You're on the latest version."
      case 'available':
        return state?.installMode === 'manualDownload'
          ? `v${state.version} is available — download to install.`
          : `v${state?.version} is available — downloading…`
      case 'downloading':
        return `Downloading v${state?.version}… ${state?.downloadProgress ?? 0}%`
      case 'downloaded':
        return `v${state?.version} is downloaded — restart to install.`
      case 'installing':
        return 'Restarting to install the update…'
      case 'error':
        return state?.error ? `Update check failed: ${state.error}` : 'Update check failed.'
      case 'unsupported':
        return 'Auto-update is unavailable for this build.'
    }
  })()

  return (
    <div className="space-y-4" data-setting-id="about-version">
      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--dplex-bg-alt)' }}>
        <div className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
          Version
        </div>
        <div className="text-sm font-mono mt-0.5" style={{ color: 'var(--dplex-text)' }}>
          {version || '—'}
          <span className="ml-2 text-[10px]" style={{ color: 'var(--dplex-text-dim)' }}>
            ({platform || '—'})
          </span>
        </div>
      </div>

      <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: 'var(--dplex-bg-alt)' }}>
        <div>
          <div className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
            Updates
          </div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--dplex-text)' }}>
            {statusLabel}
          </div>
          {state?.lastChecked && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--dplex-text-dim)' }}>
              Last checked {timeAgo(state.lastChecked)} ago
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={!state?.canCheck}
            onClick={() => void check()}
            className="text-[11px] px-3 py-1 rounded"
            style={{
              background: state?.canCheck ? 'var(--dplex-accent)' : 'var(--dplex-bg)',
              color: state?.canCheck ? 'var(--dplex-bg)' : 'var(--dplex-text-muted)',
              border: '1px solid var(--dplex-border)',
              cursor: state?.canCheck ? 'pointer' : 'not-allowed',
              opacity: state?.canCheck ? 1 : 0.6
            }}
          >
            Check for updates
          </button>
          {state?.canInstall && (
            <button
              onClick={() => void install()}
              className="text-[11px] px-3 py-1 rounded"
              style={{
                background: 'var(--dplex-accent)',
                color: 'var(--dplex-bg)'
              }}
            >
              Restart and install
            </button>
          )}
          {state?.canOpenDownload && (
            <button
              onClick={() => void openDownload()}
              className="text-[11px] px-3 py-1 rounded"
              style={{
                background: 'var(--dplex-bg)',
                color: 'var(--dplex-text)',
                border: '1px solid var(--dplex-border)'
              }}
            >
              Open download page
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
