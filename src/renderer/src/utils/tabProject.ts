import type { EditorTab, Project } from '../types'
import { isFileDiffTab, isFileEditorTab, isDashboardTab } from '../types'
import { normalizePath } from './normalizePath'
import { deriveAvatarColor, getAvatarInitials } from './projectStatus'

/**
 * Return the filesystem path that a tab should be associated with for the
 * purpose of project matching. Mirrors the precedence already used elsewhere
 * (`syncActiveProjectFromTabPath`, `focusFirstTabForPaths`):
 * worktree path → cwd for terminal tabs, repoRootFs for file-diff tabs,
 * rootFs for editable file tabs.
 */
export function getTabProjectPath(tab: EditorTab): string | undefined {
  if (isFileDiffTab(tab)) return tab.repoRootFs
  if (isFileEditorTab(tab)) return tab.rootFs
  if (isDashboardTab(tab)) return undefined
  return tab.worktreePath ?? tab.cwd
}

/**
 * Find the project a tab belongs to by longest-prefix match against the
 * registered projects. Returns `undefined` when the tab has no associated
 * path or when no project owns that path. Comparison is platform-aware
 * (case-folded on macOS/Windows) via {@link normalizePath}.
 */
export function findProjectForTab(
  tab: EditorTab,
  projects: readonly Project[]
): Project | undefined {
  const path = getTabProjectPath(tab)
  if (!path) return undefined
  const norm = normalizePath(path)
  let best: { project: Project; len: number } | undefined
  for (const p of projects) {
    const n = normalizePath(p.path)
    if (norm === n || norm.startsWith(n + '/')) {
      if (!best || n.length > best.len) best = { project: p, len: n.length }
    }
  }
  return best?.project
}

/**
 * Visual identity for a tab: the matched project, plus the "color project"
 * used to derive the avatar color and initials. Worktrees inherit their
 * parent's color so every tab belonging to the same repo (main + worktrees)
 * shares a single visual group — that's what users mean by "this project"
 * when they're switching between branches.
 */
export interface TabProjectIdentity {
  matched: Project
  colorProject: Project
  color: { bg: string; fg: string; border: string }
  initials: string
}

/**
 * The project whose color a given project should adopt: its parent origin for
 * a worktree (so a repo's main checkout + worktrees form one color group),
 * else the project itself. Orphan worktrees (parent not registered) fall back
 * to themselves. Use this anywhere a project surface needs its effective tab
 * color so worktrees stay consistent with `getTabIdentity`.
 */
export function colorSourceProject(project: Project, projects: readonly Project[]): Project {
  if (!project.parentProjectId) return project
  return projects.find((p) => p.id === project.parentProjectId) ?? project
}

export function getTabIdentity(
  tab: EditorTab,
  projects: readonly Project[]
): TabProjectIdentity | undefined {
  const matched = findProjectForTab(tab, projects)
  if (!matched) return undefined
  const colorProject = colorSourceProject(matched, projects)
  return {
    matched,
    colorProject,
    color: deriveAvatarColor(colorProject.tabColor),
    initials: getAvatarInitials(colorProject.name)
  }
}
