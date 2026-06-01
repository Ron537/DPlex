import { create } from 'zustand'
import type { AppSettings, WorktreeDefaults } from '../types'
import { getTheme } from '../services/themes'

// Read cached theme from localStorage synchronously to avoid flash
function getCachedTheme(): string {
  try {
    return localStorage.getItem('dplex-theme') || 'dplex'
  } catch {
    return 'dplex'
  }
}

function cacheTheme(themeId: string): void {
  try {
    localStorage.setItem('dplex-theme', themeId)
  } catch {
    // ignore
  }
}

// Apply CSS variables synchronously — called before React renders
export function applyCssVarsSync(themeId: string): void {
  const theme = getTheme(themeId)
  const root = document.documentElement
  root.style.setProperty('--dplex-bg', theme.ui.bg)
  root.style.setProperty('--dplex-bg-alt', theme.ui.bgAlt)
  root.style.setProperty('--dplex-bg-panel', theme.ui.bgPanel ?? theme.ui.bgAlt)
  root.style.setProperty('--dplex-bg-elev', theme.ui.bgElev ?? theme.ui.bgAlt)
  // v2 elevated tiers — fall back through the existing surface stack
  // when a theme doesn't define them so older themes still render.
  const elev2 = theme.ui.bgElev2 ?? theme.ui.bgElev ?? theme.ui.bgAlt
  const elev3 = theme.ui.bgElev3 ?? elev2
  root.style.setProperty('--dplex-bg-elev-2', elev2)
  root.style.setProperty('--dplex-bg-elev-3', elev3)
  // Alias names matching the v2 design-system docs.
  root.style.setProperty('--dplex-elevated', theme.ui.bgElev ?? theme.ui.bgAlt)
  root.style.setProperty('--dplex-elevated-2', elev2)
  root.style.setProperty('--dplex-elevated-3', elev3)
  root.style.setProperty(
    '--dplex-bg-activity',
    theme.ui.bgActivity ?? theme.ui.bgPanel ?? theme.ui.bgAlt
  )
  // Activity-bar surface — distinct from the side panel. On dark themes
  // we shade the base toward black; on light themes toward white. The
  // ActivityBar component reads this var directly so badges can match.
  root.style.setProperty(
    '--dplex-activity-bar-bg',
    theme.variant === 'light'
      ? `color-mix(in srgb, ${theme.ui.bgActivity ?? theme.ui.bgPanel ?? theme.ui.bgAlt} 82%, white)`
      : `color-mix(in srgb, ${theme.ui.bgActivity ?? theme.ui.bgPanel ?? theme.ui.bgAlt} 82%, black)`
  )
  root.style.setProperty('--dplex-bg-input', theme.ui.bgInput ?? theme.ui.bgAlt)
  root.style.setProperty('--dplex-border', theme.ui.border)
  root.style.setProperty('--dplex-border-strong', theme.ui.borderStrong ?? theme.ui.border)
  root.style.setProperty('--dplex-border-subtle', theme.ui.borderSubtle ?? theme.ui.border)
  root.style.setProperty('--dplex-text', theme.ui.text)
  root.style.setProperty('--dplex-text-2', theme.ui.text2 ?? theme.ui.text)
  root.style.setProperty('--dplex-text-muted', theme.ui.textMuted)
  root.style.setProperty('--dplex-text-dim', theme.ui.textDim ?? theme.ui.textMuted)
  root.style.setProperty(
    '--dplex-text-faint',
    theme.ui.textFaint ?? theme.ui.textDim ?? theme.ui.textMuted
  )
  root.style.setProperty('--dplex-accent', theme.ui.accent)
  root.style.setProperty('--dplex-accent-2', theme.ui.accent2 ?? theme.ui.accent)
  root.style.setProperty(
    '--dplex-accent-3',
    theme.ui.accent3 ?? theme.ui.accent2 ?? theme.ui.accent
  )
  const accentAlt = theme.ui.accentAlt ?? theme.ui.accent2 ?? theme.ui.accent
  root.style.setProperty('--dplex-accent-alt', accentAlt)
  root.style.setProperty('--dplex-accent-soft', hexToRgba(theme.ui.accent, 0.12))
  root.style.setProperty('--dplex-accent-softer', hexToRgba(theme.ui.accent, 0.06))
  root.style.setProperty('--dplex-accent-faint', hexToRgba(theme.ui.accent, 0.04))
  root.style.setProperty('--dplex-accent-ring', hexToRgba(theme.ui.accent, 0.28))
  root.style.setProperty('--dplex-accent-glow', hexToRgba(theme.ui.accent, 0.25))
  root.style.setProperty(
    '--dplex-gradient',
    `linear-gradient(135deg, ${theme.ui.accent} 0%, ${accentAlt} 100%)`
  )
  root.style.setProperty(
    '--dplex-gradient-soft',
    `linear-gradient(135deg, ${hexToRgba(theme.ui.accent, 0.15)} 0%, ${hexToRgba(accentAlt, 0.15)} 100%)`
  )
  root.style.setProperty('--dplex-hover', theme.ui.hover || 'rgba(255,255,255,0.04)')
  root.style.setProperty('--dplex-scrollbar', theme.ui.scrollbar || 'rgba(255,255,255,0.15)')
  root.style.setProperty(
    '--dplex-scrollbar-hover',
    theme.ui.scrollbarHover || 'rgba(255,255,255,0.25)'
  )

  // Status colors — adapted for contrast on light vs dark backgrounds.
  // Each token must remain visually distinct from every other token in
  // both variants. The dark hues match the soft-pill rules in main.css.
  // v2 palette: violet (thinking), cyan (executing), amber (approval),
  // orange (waiting), emerald (success/active), red (error).
  const isLight = theme.variant === 'light'
  root.style.setProperty('--dplex-status-idle', isLight ? '#A1A1AA' : '#52525B')
  root.style.setProperty('--dplex-status-thinking', isLight ? '#7C3AED' : '#A78BFA')
  root.style.setProperty('--dplex-status-executing', isLight ? '#0891B2' : '#22D3EE')
  root.style.setProperty('--dplex-status-approval', isLight ? '#D97706' : '#F59E0B')
  root.style.setProperty('--dplex-status-waiting', isLight ? '#EA580C' : '#FB923C')
  root.style.setProperty('--dplex-status-active', isLight ? '#059669' : '#34D399')
  root.style.setProperty(
    '--dplex-status-active-bg',
    isLight ? 'rgba(5,150,105,0.12)' : 'rgba(52,211,153,0.12)'
  )
  // Semantic status — new in v2. success ≈ active; error/warning/info
  // are emitted explicitly so non-pill surfaces (notifications, modal
  // headers, file badges) can use the same palette.
  root.style.setProperty('--dplex-status-success', isLight ? '#059669' : '#34D399')
  root.style.setProperty('--dplex-status-warning', isLight ? '#D97706' : '#F59E0B')
  root.style.setProperty('--dplex-status-error', isLight ? '#DC2626' : '#F87171')
  root.style.setProperty('--dplex-status-info', isLight ? '#2563EB' : '#60A5FA')
  // Stronger error fill — used as a *background* for destructive solid
  // buttons. The soft `--dplex-status-error` reads as a 2.7:1 contrast
  // against white text and fails WCAG AA, so we emit a deeper red for
  // fills paired with white labels.
  root.style.setProperty('--dplex-status-error-strong', isLight ? '#B91C1C' : '#DC2626')
  // Foreground for accent-filled badges/buttons. Pairing white text with
  // the violet accent (#A78BFA) fails AA at small sizes; the dark canvas
  // color reads at ~7:1 against violet. On light themes pure white still
  // wins against the deeper violet shades.
  root.style.setProperty('--dplex-accent-fg', isLight ? '#FFFFFF' : theme.ui.bg)

  document.body.style.backgroundColor = theme.ui.bg
  // Tell the browser to render native form controls (checkboxes, radios, ranges,
  // time inputs, scrollbars) in the matching light/dark mode.
  root.style.colorScheme = isLight ? 'light' : 'dark'
}

/**
 * Best-effort color → rgba() with the supplied alpha. Accepts #rgb, #rrggbb,
 * `rgb(r,g,b)`, or `rgba(r,g,b,a)`. The supplied `alpha` always wins —
 * any alpha encoded in an input `rgba(...)` string is overridden so callers
 * get the requested opacity regardless of the theme token's source format.
 * Used to derive the soft accent tint from any theme's accent color.
 */
function hexToRgba(color: string, alpha: number): string {
  const trimmed = color.trim()
  // rgb()/rgba() passthrough — re-emit with the requested alpha.
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i
  )
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`
  }
  const hex = trimmed.replace(/^#/, '')
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  return color
}

const cachedTheme = getCachedTheme()

let sidebarWidthPersistTimer: ReturnType<typeof setTimeout> | null = null

export const DEFAULT_WORKTREE_DEFAULTS: WorktreeDefaults = {
  locationPattern: '../{project}-{branch}',
  envFiles: ['.env', '.env.local', '.env.*.local'],
  setupScript: '',
  afterCreate: 'session'
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultShell: '',
  defaultAITool: 'copilot-cli',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  macOptionIsMeta: true,
  theme: cachedTheme,
  sidebarWidth: 260,
  sidebarVisible: true,
  sidebarActiveTab: 'projects',
  sidebarPanelCollapsed: false,
  sessionPollIntervalMs: 5000,
  sessionMaxAgeDays: 7,
  watcherDebounceMs: null,
  hideEmptySessions: true,
  showRecentSessionsInProject: true,
  recentSessionsCount: 3,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnFinished: true,
  notifyOnlyWhenUnfocused: true,
  notificationSound: false,
  dndFrom: null,
  dndTo: null,
  notificationCooldownSeconds: 30,
  idleTooLongMinutes: 5,
  attentionClickClearsWaiting: false,
  worktreeDefaults: DEFAULT_WORKTREE_DEFAULTS,
  projectPanelShowFooter: true,
  tagColors: {},
  gitPanel: {
    open: false,
    width: 300,
    sectionCollapse: { changes: false }
  },
  skippedUpdateVersion: null
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
      const saved = (await window.dplex.settings.getAll()) as Partial<AppSettings>
      const merged: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...saved,
        worktreeDefaults: {
          ...DEFAULT_WORKTREE_DEFAULTS,
          ...(saved.worktreeDefaults ?? {})
        },
        gitPanel: {
          ...DEFAULT_SETTINGS.gitPanel,
          ...(saved.gitPanel ?? {}),
          sectionCollapse: {
            ...DEFAULT_SETTINGS.gitPanel.sectionCollapse,
            ...(saved.gitPanel?.sectionCollapse ?? {})
          }
        }
      }
      set({ settings: merged, loaded: true })
      cacheTheme(merged.theme)
    } catch {
      set({ loaded: true })
    }
  },

  updateSettings: async (partial) => {
    const newSettings = { ...get().settings, ...partial }
    set({ settings: newSettings })
    if (partial.theme) cacheTheme(partial.theme)
    // Atomic merge — avoids read-modify-write race with projectStore
    await window.dplex.settings.merge(partial)
  },

  toggleSidebar: () => {
    const current = get().settings
    const next = !current.sidebarPanelCollapsed
    set({ settings: { ...current, sidebarPanelCollapsed: next } })
    get().updateSettings({ sidebarPanelCollapsed: next })
  },

  setSidebarWidth: (width) => {
    const current = get().settings
    set({ settings: { ...current, sidebarWidth: width } })
    // Debounced persist — called on every pixel during resize
    if (sidebarWidthPersistTimer) clearTimeout(sidebarWidthPersistTimer)
    sidebarWidthPersistTimer = setTimeout(() => {
      get().updateSettings({ sidebarWidth: width })
    }, 500)
  }
}))
