import { create } from 'zustand'
import type { AppSettings } from '../types'

const DEFAULT_SETTINGS: AppSettings = {
  defaultShell: '',
  defaultAITool: 'copilot-cli',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: 'dark',
  sidebarWidth: 260,
  sidebarVisible: true,
  sessionPollIntervalMs: 5000
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    try {
      const saved = await window.tplex.settings.getAll()
      set({ settings: { ...DEFAULT_SETTINGS, ...saved }, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  updateSettings: async (partial) => {
    const newSettings = { ...get().settings, ...partial }
    set({ settings: newSettings })
    await window.tplex.settings.setAll(newSettings)
  },

  toggleSidebar: () => {
    const current = get().settings
    set({ settings: { ...current, sidebarVisible: !current.sidebarVisible } })
  },

  setSidebarWidth: (width) => {
    const current = get().settings
    set({ settings: { ...current, sidebarWidth: width } })
  }
}))
