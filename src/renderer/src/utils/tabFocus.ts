import type { EditorTab, LayoutNode, Project } from '../types'
import { getTabIdentity } from './tabProject'

/**
 * Whether a tab belongs to the focused project for the purpose of the focus
 * filter. A tab matches when its resolved project identity's matched project
 * OR its color (parent) project equals the target — so a repo's main project
 * and all its worktree tabs are treated as one focus group, mirroring the
 * visual grouping in {@link getTabIdentity}.
 *
 * Tabs with no project identity (plain shell terminals, file/diff tabs outside
 * any registered project) never match — in isolate mode they are hidden.
 */
export function tabMatchesFocus(
  tab: EditorTab,
  projects: readonly Project[],
  targetProjectId: string | null
): boolean {
  if (!targetProjectId) return true
  const identity = getTabIdentity(tab, projects)
  if (!identity) return false
  return identity.colorProject.id === targetProjectId || identity.matched.id === targetProjectId
}

/**
 * Prune a layout tree to only the groups whose ids remain visible, collapsing
 * splits down as groups disappear. Returns `null` when nothing is left. Shared
 * by the isolate render view (AppLayout) and the workspace-restore path so the
 * pruning stays consistent.
 */
export function pruneLayoutToGroups(
  node: LayoutNode,
  visibleGroupIds: ReadonlySet<string>
): LayoutNode | null {
  if (node.type === 'group') {
    return node.groupId && visibleGroupIds.has(node.groupId) ? node : null
  }
  if (!node.children) return null
  const filtered = node.children
    .map((child) => pruneLayoutToGroups(child, visibleGroupIds))
    .filter(Boolean) as LayoutNode[]
  if (filtered.length === 0) return null
  if (filtered.length === 1) return filtered[0]
  return { ...node, children: filtered }
}
