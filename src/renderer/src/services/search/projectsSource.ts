import { createElement } from 'react'
import type { SearchItem, SearchSource } from './types'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { focusFirstTabForPaths } from '../../utils/sessionTabs'
import { pathBasename } from './pathUtils'
import { ProjectAvatar } from '../../components/projects/ProjectAvatar'

/** Activate a project: ensure the Projects view is visible, set it active,
 *  and focus any existing terminal tab in its directory. Mirrors what
 *  clicking the project row in the side panel does. */
function openProject(projectId: string): void {
  const projectStore = useProjectStore.getState()
  const project = projectStore.projects.find((p) => p.id === projectId)
  if (!project) return

  // Show the Projects side panel + select the project.
  useSettingsStore
    .getState()
    .updateSettings({ sidebarActiveTab: 'projects', sidebarPanelCollapsed: false })
  projectStore.setActiveProject(projectId)
  projectStore.setLastExpanded(projectId)

  // Try to focus an existing terminal tab in the project's directory.
  const paths = new Set<string>([project.path])
  for (const p of projectStore.projects) {
    if (p.parentProjectId === projectId) paths.add(p.path)
  }
  focusFirstTabForPaths(paths)
}

export const projectsSource: SearchSource = {
  category: 'projects',
  getItems: (ctx): SearchItem[] => {
    return ctx.projects.map((p) => {
      const isWorktree = p.parentProjectId !== undefined
      const description = isWorktree ? `Worktree · ${p.path}` : p.path
      // Tag keywords are emitted both bare (`infra`) and with a leading `#`
      // so users can type `#infra` to filter the palette and have it match.
      const tagKeywords =
        p.tags && p.tags.length > 0 ? [...p.tags, ...p.tags.map((t) => `#${t}`)] : []
      const item: SearchItem = {
        id: `project:${p.id}`,
        category: 'projects',
        label: p.name,
        description,
        keywords: [pathBasename(p.path), p.path, ...(p.pinned ? ['pinned'] : []), ...tagKeywords],
        ...(p.tags && p.tags.length > 0 ? { tags: [...p.tags] } : {}),
        icon: createElement(ProjectAvatar, { projectId: p.id, name: p.name }),
        run: () => openProject(p.id)
      }
      if (p.parentRepoName) {
        item.hint = p.parentRepoName
      }
      return item
    })
  }
}
