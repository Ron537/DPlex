import { createElement } from 'react'
import type { SearchItem, SearchSource } from './types'
import { isTerminalTab } from '../../types'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { SpaceAvatar } from '../../components/spaces/SpaceAvatar'
import { boundProjects, sessionCount } from '../../components/spaces/spaceVisuals'

/** Switch to a space from search: reveal the Spaces side panel for context,
 *  then bring the space into focus. `switchSpace` only re-mounts existing
 *  terminals, so nothing restarts — the previous space auto-backgrounds. */
function openSpace(spaceId: string): void {
  useSettingsStore.getState().updateSettings({
    sidebarActiveTab: 'spaces',
    sidebarPanelCollapsed: false,
    sidebarVisible: true
  })
  useSpaceStore.getState().switchSpace(spaceId)
}

/** Pluralize a count with its noun, e.g. `count(2, 'project') → "2 projects"`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export const spacesSource: SearchSource = {
  category: 'spaces',
  getItems: (ctx): SearchItem[] => {
    // The active space's live tabs live in the terminal store, not its stashed
    // snapshot, so count those from the live groups; background spaces read
    // their (accurate) snapshot.
    const liveSessions = ctx.groups.reduce(
      (total, g) => total + g.tabs.filter(isTerminalTab).length,
      0
    )
    return ctx.spaces.map((s) => {
      const isActive = s.id === ctx.activeSpaceId
      const projects = boundProjects(s, ctx.projects)
      const sessions = isActive ? liveSessions : sessionCount(s.workspace)
      const parts: string[] = []
      if (projects.length > 0) parts.push(count(projects.length, 'project'))
      parts.push(count(sessions, 'session'))
      const item: SearchItem = {
        id: `space:${s.id}`,
        category: 'spaces',
        label: s.name,
        description: parts.join(' · '),
        // Find a space by any repo it holds, not just its own name.
        keywords: ['space', 'workspace', 'context', ...projects.map((p) => p.name)],
        icon: createElement(SpaceAvatar, { space: s, size: 24 }),
        run: () => openSpace(s.id)
      }
      if (isActive) item.hint = 'In focus'
      return item
    })
  }
}
