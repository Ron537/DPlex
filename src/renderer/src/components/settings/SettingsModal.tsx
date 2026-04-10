import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Settings, Palette, Terminal, Bot, Keyboard } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { getThemeList, getTheme } from '../../services/themes'
import { applyThemeToAll } from '../../services/terminalRegistry'
import type { ShellInfo, AppSettings } from '../../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = 'appearance' | 'terminal' | 'ai-tools' | 'shortcuts'

const isMac = navigator.platform.toUpperCase().includes('MAC')
const MOD = isMac ? '⌘' : 'Ctrl+'

const SHORTCUTS: { category: string; items: { keys: string; description: string }[] }[] = [
  {
    category: 'General',
    items: [
      { keys: `${MOD}T`, description: 'New terminal' },
      { keys: `${MOD}W`, description: 'Close terminal' },
      { keys: `${MOD},`, description: 'Open settings' },
      { keys: `${MOD}B`, description: 'Toggle sidebar' }
    ]
  },
  {
    category: 'Layout',
    items: [
      { keys: `${MOD}\\`, description: 'Split right' },
      { keys: `${MOD}⇧\\`, description: 'Split down' }
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

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'ai-tools', label: 'AI Tools', icon: Bot },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard }
]

function SettingItem({ label, description, children }: {
  label: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="mb-5 last:mb-0">
      <span className="block text-[11px] font-medium mb-0.5" style={{ color: 'var(--dplex-text)' }}>{label}</span>
      {description && (
        <p className="text-[10px] mb-2" style={{ color: 'var(--dplex-text-muted)' }}>{description}</p>
      )}
      {children}
    </div>
  )
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const themes = getThemeList()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isOpen) {
      window.dplex.app.getAvailableShells().then(setShells)
    }
  }, [isOpen])

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
      updateSettings(partial)
    }, 400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-lg shadow-2xl w-[580px] h-[420px] flex flex-col" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--dplex-border)' }}>
          <div className="flex items-center gap-2" style={{ color: 'var(--dplex-text)' }}>
            <Settings size={16} />
            <span className="text-sm font-medium">Settings</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Vertical tab sidebar */}
          <div className="w-[150px] flex-shrink-0 py-2 px-2 space-y-0.5" style={{ borderRight: '1px solid var(--dplex-border)' }}>
            {TABS.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] transition-colors text-left"
                  style={{
                    backgroundColor: isActive ? 'var(--dplex-bg-alt)' : 'transparent',
                    color: isActive ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
                    borderLeft: isActive ? '2px solid var(--dplex-accent)' : '2px solid transparent'
                  }}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 p-5 overflow-y-auto">
            {activeTab === 'appearance' && (
              <SettingItem label="Theme" description="Controls the color theme for the terminal and UI.">
                <div className="grid grid-cols-3 gap-2">
                  {themes.map((t) => {
                    const theme = getTheme(t.id)
                    const isSelected = settings.theme === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => applyNow({ theme: t.id })}
                        className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-colors ${
                          isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-zinc-500'
                        }`}
                        style={{ borderColor: isSelected ? undefined : 'var(--dplex-border)' }}
                      >
                        <div
                          className="w-full h-6 rounded flex items-center gap-0.5 px-1"
                          style={{ backgroundColor: theme.terminal.background as string }}
                        >
                          <span style={{ color: theme.terminal.green as string, fontSize: 8 }}>$</span>
                          <span style={{ color: theme.terminal.foreground as string, fontSize: 8 }}>hello</span>
                          <span style={{ color: theme.terminal.blue as string, fontSize: 8 }}>~</span>
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>{t.name}</span>
                      </button>
                    )
                  })}
                </div>
              </SettingItem>
            )}

            {activeTab === 'terminal' && (
              <>
                <SettingItem label="Default Shell" description="The shell used when opening new terminals. Override per-tab with the dropdown next to the + button.">
                  <select
                    value={settings.defaultShell}
                    onChange={(e) => applyNow({ defaultShell: e.target.value })}
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
                  >
                    <option value="">System default</option>
                    {shells.map((s) => (
                      <option key={s.path} value={s.path}>{s.name} ({s.path})</option>
                    ))}
                  </select>
                </SettingItem>

                <SettingItem label="Font Size" description={`Controls the terminal font size in pixels. Currently ${settings.fontSize}px.`}>
                  <input
                    type="range" min={10} max={24}
                    value={settings.fontSize}
                    onChange={(e) => applyDebounced({ fontSize: Number(e.target.value) })}
                    className="w-full accent-blue-500"
                  />
                </SettingItem>

                <SettingItem label="Font Family" description="Controls the terminal font family. Use a monospace font for best results.">
                  <input
                    type="text"
                    value={settings.fontFamily}
                    onChange={(e) => applyDebounced({ fontFamily: e.target.value })}
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
                  />
                </SettingItem>
              </>
            )}

            {activeTab === 'ai-tools' && (
              <>
                <SettingItem label="Default AI Tool" description="The AI CLI tool used for session discovery and integration.">
                  <select
                    value={settings.defaultAITool}
                    onChange={(e) => applyNow({ defaultAITool: e.target.value })}
                    className="w-full rounded px-3 py-1.5 text-xs outline-none"
                    style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
                  >
                    <option value="copilot-cli">Copilot CLI</option>
                    <option value="claude-code">Claude Code</option>
                  </select>
                </SettingItem>
              </>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                {SHORTCUTS.map((group) => (
                  <div key={group.category}>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--dplex-accent)' }}>
                      {group.category}
                    </h4>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <div
                          key={item.keys}
                          className="flex items-center justify-between py-1.5 px-2 rounded"
                          style={{ backgroundColor: 'var(--dplex-bg-alt)' }}
                        >
                          <span className="text-[11px]" style={{ color: 'var(--dplex-text)' }}>{item.description}</span>
                          <kbd
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text-muted)' }}
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
        </div>
      </div>
    </div>
  )
}
