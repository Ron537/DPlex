import { useState } from 'react'
import { X, Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [localSettings, setLocalSettings] = useState(settings)

  if (!isOpen) return null

  const handleSave = (): void => {
    updateSettings(localSettings)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg shadow-2xl w-[480px] max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a4a]">
          <div className="flex items-center gap-2 text-zinc-200">
            <Settings size={16} />
            <span className="text-sm font-medium">Settings</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {/* AI Tool */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Default AI Tool</label>
            <select
              value={localSettings.defaultAITool}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, defaultAITool: e.target.value })
              }
              className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500/50"
            >
              <option value="copilot-cli">Copilot CLI</option>
              <option value="claude-code">Claude Code (coming soon)</option>
            </select>
          </div>

          {/* Shell */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Shell Path</label>
            <input
              type="text"
              value={localSettings.defaultShell}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, defaultShell: e.target.value })
              }
              placeholder="Leave empty for default shell"
              className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Font Size */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
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
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Font Family</label>
            <input
              type="text"
              value={localSettings.fontFamily}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, fontFamily: e.target.value })
              }
              className="w-full bg-[#141428] border border-[#2a2a4a] rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Poll Interval */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
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

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#2a2a4a]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-white/10 rounded transition-colors"
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
