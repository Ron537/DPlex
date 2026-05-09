import type { SearchItem, SearchSource } from './types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProvidersStore } from '../../stores/providersStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { focusSessionTab } from '../../utils/sessionTabs'
import { pathBasename } from './pathUtils'

async function openSession(sessionId: string, providerId: string, cwd?: string): Promise<void> {
  // Surface the Sessions panel so the row context is visible.
  useSettingsStore
    .getState()
    .updateSettings({ sidebarActiveTab: 'sessions', sidebarPanelCollapsed: false })

  // Reuse the existing helper — focus any open tab first.
  if (focusSessionTab(sessionId, providerId)) return

  const cmd = await window.dplex.sessions.getResumeCommand(providerId, sessionId)
  if (focusSessionTab(sessionId, providerId, cmd ?? undefined)) return
  if (!cmd) return

  useTerminalStore
    .getState()
    .createTerminal(undefined, `↻ ${pathBasename(cwd) || sessionId}`, cmd, undefined, cwd, providerId)
}

export const sessionsSource: SearchSource = {
  category: 'sessions',
  getItems: (ctx): SearchItem[] => {
    const getProviderLabel = useProvidersStore.getState().getLabel
    return ctx.sessions.map((s) => {
      const providerLabel = getProviderLabel(s.aiTool)
      const desc = s.summary?.trim() || s.cwd || ''
      const item: SearchItem = {
        id: `session:${s.aiTool}:${s.id}`,
        category: 'sessions',
        label: s.displayName,
        description: desc,
        hint: providerLabel,
        keywords: [
          providerLabel,
          s.aiTool,
          ...(s.cwd ? [s.cwd, pathBasename(s.cwd)] : []),
          ...(s.branch ? [s.branch] : []),
          ...(s.summary ? [s.summary] : []),
          s.status === 'active' ? 'active' : 'idle'
        ],
        run: () => openSession(s.id, s.aiTool, s.cwd)
      }
      return item
    })
  }
}
