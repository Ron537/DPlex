import type { Project } from '../types'
import { useProjectStore } from '../stores/projectStore'
import { useSpaceStore } from '../stores/spaceStore'
import { useTerminalStore } from '../stores/terminalStore'

/**
 * Shared "start work" actions used by the Space surfaces (switcher quick-start,
 * empty-workspace state) and the Projects panel. Each opens a tab in the
 * terminal store: while a space is in focus the tab joins it; from the Overview
 * the orphan-adoption net in `spaceStore` adopts it into a fresh space named
 * after the project.
 *
 * Kept as thin store wrappers (not inline in components) so every surface
 * launches work identically — the provider-resolution logic lives once in
 * `projectStore`.
 */

/** Start an AI session for a project. `providerId` overrides the default AI
 *  tool; otherwise the configured default (or first registered) provider wins.
 *
 *  Provider resolution is async (two IPC round-trips). If the user switches to
 *  another space during it, the freshly created tab would otherwise land in the
 *  wrong workspace, so we capture the space the launch was requested from and
 *  re-focus it before creating the tab. Re-focusing never restarts anything —
 *  `switchSpace` only re-mounts existing terminals. Launches from the Overview
 *  (no origin space) intentionally land wherever work now goes, so the user
 *  isn't yanked out of a space they've since opened.
 *
 *  When launched from within a space, the project is bound to that space (if it
 *  wasn't already) so the space's project list stays in step with the work
 *  running inside it. */
export function startProjectSession(project: Project, providerId?: string): void {
  const originSpaceId = useSpaceStore.getState().activeSpaceId
  void useProjectStore
    .getState()
    .resolveAISession(project, providerId)
    .then((resolved) => {
      if (!resolved) return
      const spaces = useSpaceStore.getState()
      if (originSpaceId && spaces.activeSpaceId !== originSpaceId) {
        spaces.switchSpace(originSpaceId)
      }
      useProjectStore.getState().createAISessionTab(resolved)
      if (originSpaceId) {
        useSpaceStore.getState().addProjectToSpace(originSpaceId, project.id)
      }
    })
}

/** Open a plain shell terminal rooted at a project's path. When a space is in
 *  focus the project is bound to it (if not already), matching the session
 *  behaviour above. */
export function openProjectTerminal(project: Project): void {
  const activeSpaceId = useSpaceStore.getState().activeSpaceId
  useTerminalStore
    .getState()
    .createTerminal(undefined, project.name, undefined, undefined, project.path)
  if (activeSpaceId) {
    useSpaceStore.getState().addProjectToSpace(activeSpaceId, project.id)
  }
}

/** Open a plain shell terminal with no project association. */
export function openPlainTerminal(): void {
  useTerminalStore.getState().createTerminal()
}
