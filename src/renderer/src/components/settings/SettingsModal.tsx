import { useState, useEffect } from 'react'
import { X, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { getThemeList, getTheme } from '../../services/themes'
import { applyThemeToAll } from '../../services/terminalRegistry'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [localSettings, setLocalSettings] = useState(settings)
  const themes = getThemeList()

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) setLocalSettings(settings)
  }, [isOpen, settings])

  if (!isOpen) return null

  const handleSave = (): void => {
    updateSettings(localSettings)
    applyThemeToAll(localSettings.theme)
    onClose()
  }

  const selectedTheme = getTheme(localSettings.theme)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="rounded-lg shadow-2xl w-[480px] max-h-[80vh] flex flex-col" style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}>
        {/* Header — fixed */}
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
        <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* Theme */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>Theme</label>
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
                        : 'border-[#2a2a4a] hover:border-zinc-500'
                    }`}
                  >
                    {/* Color preview */}
                    <div
                      className="w-full h-6 rounded flex items-center gap-0.5 px-1"
                      style={{ backgroundColor: theme.terminal.background as string }}
                    >
                      <span style={{ color: theme.terminal.green as string, fontSize: 8 }}>$</span>
                      <span style={{ color: theme.terminal.foreground as string, fontSize: 8 }}>hello</span>
                      <span style={{ color: theme.terminal.blue as string, fontSize: 8 }}>~</span>
                    </div>
                    <span className="text-[10px] text-zinc-300">{t.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* AI Tool */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>Default AI Tool</label>
            <select
              value={localSettings.defaultAITool}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, defaultAITool: e.target.value })
              }
              className="w-full rounded px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            >
              <option value="copilot-cli">Copilot CLI</option>
              <option value="claude-code">Claude Code (coming soon)</option>
            </select>
          </div>

          {/* Shell */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>Shell Path</label>
            <input
              type="text"
              value={localSettings.defaultShell}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, defaultShell: e.target.value })
              }
              placeholder="Leave empty for default shell"
              className="w-full rounded px-3 py-2 text-sm placeholder-zinc-600 outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            />
          </div>

          {/* Font Size */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>
              Font Size ({localSettings.fontSize}px)
            </label>
            <input
              type="range"
              min={10}
              max={24}
              value={localSettings.fontSize}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, fontSize: Number(e.target.value) })
              }
              className="w-full accent-blue-500"
            />
          </div>

          {/* Font Family */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>Font Family</label>
            <input
              type="text"
              value={localSettings.fontFamily}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, fontFamily: e.target.value })
              }
              className="w-full rounded px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: 'var(--dplex-bg-alt)', border: '1px solid var(--dplex-border)', color: 'var(--dplex-text)' }}
            />
          </div>

          {/* Poll Interval */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--dplex-text-muted)' }}>
              Session poll interval ({localSettings.sessionPollIntervalMs / 1000}s)
            </label>
            <input
              type="range"
              min={2000}
              max={30000}
              step={1000}
              value={localSettings.sessionPollIntervalMs}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  sessionPollIntervalMs: Number(e.target.value)
                })
              }
              className="w-full accent-blue-500"
            />
          </div>
        </div>

        {/* Footer — fixed at bottom */}
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
