import { createElement } from 'react'
import type { SearchItem, SearchSource } from './types'
import { useProvidersStore } from '../../stores/providersStore'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  resumeSessionGuarded,
  type GuardableSession
} from '../../stores/externalResumeConfirmStore'
import { pathBasename } from './pathUtils'
import { ProviderGlyph } from '../../components/common/ProviderGlyph'
import type { ProviderId } from '../../utils/providerHelpers'

function openSession(session: GuardableSession): void {
  // Surface the Sessions panel so the row context is visible.
  useSettingsStore
    .getState()
    .updateSettings({ sidebarActiveTab: 'sessions', sidebarPanelCollapsed: false })

  // Reuse the shared resume path — focuses an open tab if any, confirms
  // first when the session is running outside DPlex, otherwise resumes.
  resumeSessionGuarded(session)
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
        icon: createElement(ProviderGlyph, {
          providerId: s.aiTool as ProviderId,
          size: 'sm',
          title: providerLabel
        }),
        keywords: [
          providerLabel,
          s.aiTool,
          ...(s.cwd ? [s.cwd, pathBasename(s.cwd)] : []),
          ...(s.branch ? [s.branch] : []),
          ...(s.summary ? [s.summary] : []),
          s.status === 'active' ? 'active' : 'idle'
        ],
        run: () => openSession(s)
      }
      return item
    })
  }
}
