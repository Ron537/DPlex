import { useState, useEffect } from 'react'
import { X, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { getThemeList, getTheme } from '../../services/themes'
import { applyThemeToAll } from '../../services/terminalRegistry'
import type { ShellInfo } from '../../types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <div className="pb-1 mb-4" style={{ borderBottom: '1px solid var(--dplex-border)' }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--dplex-accent)' }}>
        {title}
      </h3>
    </div>
  )
}

function SettingItem({ label, description, children }: {
  label: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-start gap-1 mb-1">
        <span className="text-[11px] font-medium" style={{ color: 'var(--dplex-text)' }}>{label}</span>
      </div>
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
  const [localSettings, setLocalSettings] = useState(settings)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const themes = getThemeList()

  useEffect(() => {
    if (isOpen) {
      setLocalSettings(settings)
      window.dplex.app.getAvailableShells().then(setShells)
    }
  }, [isOpen, settings])

  if (!isOpen) return null

  const handleSave = (): void => {
    updateSettings(localSettings)
    applyThemeToAll(localSettings.theme)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-lg shadow-2xl w-[520px] max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
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

        {/* Body — scrollable */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">

          {/* ── Appearance ── */}
          <SectionHeader title="Appearance" />

          <SettingItem label="Theme" description="Controls the color theme for the terminal and UI.">
            <div className="grid grid-cols-3 gap-2">
              {themes.map((t) => {
                const theme = getTheme(t.id)
                const isSelected = localSettings.theme === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => setLocalSettings({ ...localSettings, theme: t.id })}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-transparent hover:border-zinc-500'
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

          {/* ── Terminal ── */}
          <div className="mt-6" />
          <SectionHeader title="Terminal" />

          <SettingItem label="Default Shell" description="The shell used when opening new terminals. Override per-tab with the dropdown next to the + button.">
            <select
              value={localSettings.defaultShell}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultShell: e.target.value })}
              className="w-full rounded px-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            >
              <option value="">System default</option>
              {shells.map((s) => (
                <option key={s.path} value={s.path}>{s.name} ({s.path})</option>
              ))}
            </select>
          </SettingItem>

          <SettingItem label="Font Size" description={`Controls the terminal font size in pixels. Currently ${localSettings.fontSize}px.`}>
            <input
              type="range"
              min={10}
              max={24}
              value={localSettings.fontSize}
              onChange={(e) => setLocalSettings({ ...localSettings, fontSize: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </SettingItem>

          <SettingItem label="Font Family" description="Controls the terminal font family. Use a monospace font for best results.">
            <input
              type="text"
              value={localSettings.fontFamily}
              onChange={(e) => setLocalSettings({ ...localSettings, fontFamily: e.target.value })}
              className="w-full rounded px-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            />
          </SettingItem>

          {/* ── AI Tools ── */}
          <div className="mt-6" />
          <SectionHeader title="AI Tools" />

          <SettingItem label="Default AI Tool" description="The AI CLI tool used for session discovery and integration.">
            <select
              value={localSettings.defaultAITool}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultAITool: e.target.value })}
              className="w-full rounded px-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            >
              <option value="copilot-cli">Copilot CLI</option>
              <option value="claude-code">Claude Code (coming soon)</option>
            </select>
          </SettingItem>

          <SettingItem label="Session Poll Interval" description={`How often to scan for AI sessions. Currently every ${localSettings.sessionPollIntervalMs / 1000} seconds.`}>
            <input
              type="range"
              min={2000}
              max={30000}
              step={1000}
              value={localSettings.sessionPollIntervalMs}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionPollIntervalMs: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
          </SettingItem>

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--dplex-border)' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs hover:bg-white/10 rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
