import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useSpaceStore } from '../stores/spaceStore'
import { registerExitHandler, registerDestroyCleanup } from './terminalRegistry'
import type { Project } from '../types'

export interface WorktreePostCreateInput {
  /** Origin project the worktree was created from. */
  originProject: Project
  worktreePath: string
  branch: string
  afterCreate: 'session' | 'terminal' | 'none'
  providerId: string | null
  setupScript: string
  createdByDplexWorktree?: boolean
  /**
   * The Space in focus when the user *initiated* the worktree — captured before
   * the (possibly slow) create IPC so a Space switch during creation can't
   * mis-route the setup/afterCreate tabs. `undefined` when the caller didn't
   * capture it (falls back to the active Space at handle time); `null` means the
   * worktree was started from the Overview (no routing).
   */
  originSpaceId?: string | null
}

/**
 * After a worktree is created on disk, register it as its own top-level
 * project and (optionally) run the setup script + afterCreate action.
 *
 * The worktree-project gets a `parentProjectId` back to its origin, which
 * the renderer uses to nest it under the parent in the projects list.
 *
 * Returns the newly created project.
 */
export async function handleWorktreeCreated(input: WorktreePostCreateInput): Promise<Project> {
  const {
    originProject,
    worktreePath,
    branch,
    afterCreate,
    providerId,
    setupScript,
    createdByDplexWorktree,
    originSpaceId: originSpaceIdInput
  } = input

  const newProject = useProjectStore.getState().addWorktreeProject({
    parentProjectId: originProject.id,
    path: worktreePath,
    branch,
    createdByDplexWorktree: createdByDplexWorktree ?? true
  })

  // The Space in focus when the worktree was requested. The setup script can
  // run for minutes, and its exit handler (runAfterCreate) fires long after —
  // by then the user may have switched Spaces. Route the deferred tab creation
  // back to the originating Space so worktree work never lands in an unrelated
  // Space. Prefer the id captured by the caller *before* the create IPC (a
  // switch during creation would otherwise be mis-attributed); fall back to the
  // current active Space only when the caller didn't provide one. Null (worktree
  // created from the Overview) → no routing.
  const originSpaceId =
    originSpaceIdInput !== undefined ? originSpaceIdInput : useSpaceStore.getState().activeSpaceId

  const termStore = useTerminalStore.getState()

  const runAfterCreate = async (): Promise<void> => {
    if (afterCreate === 'session') {
      // Resolve the provider + launch command FIRST (async IPC), THEN focus the
      // origin Space and create the tab — both synchronous, with no await
      // between, so a concurrent Space switch can't land the session in the
      // wrong Space. (createTerminal binds to whatever workspace is active at
      // the moment of creation.)
      const resolved = await useProjectStore
        .getState()
        .resolveAISession(newProject, providerId ?? undefined)
      // If the origin Space was deleted during the (brief) resolve above,
      // focusForDeferredWork is a no-op and the session lands in whatever Space
      // is active — intentionally kept usable rather than dropped, matching the
      // "unassigned sessions remain usable" rule. (In the delete-mid-setup path
      // the exit handler is cancelled outright, so this only covers a *normal*
      // setup exit racing a concurrent delete.)
      useSpaceStore.getState().focusForDeferredWork(originSpaceId)
      if (resolved) {
        const tabId = useProjectStore.getState().createAISessionTab(resolved)
        if (tabId) {
          useTerminalStore.getState().setWorktreeMetadata(tabId, worktreePath, branch)
        }
      }
    } else if (afterCreate === 'terminal') {
      useSpaceStore.getState().focusForDeferredWork(originSpaceId)
      const tabId = useTerminalStore
        .getState()
        .createTerminal(undefined, branch, undefined, undefined, worktreePath)
      useTerminalStore.getState().setWorktreeMetadata(tabId, worktreePath, branch)
    }
  }

  const trimmedScript = setupScript.trim()
  if (trimmedScript) {
    let prepared: Awaited<ReturnType<typeof window.dplex.worktrees.prepareSetupScript>> | null =
      null
    try {
      prepared = await window.dplex.worktrees.prepareSetupScript(trimmedScript)
      useSpaceStore.getState().focusForDeferredWork(originSpaceId)
      const setupTabId = termStore.createTerminal(
        undefined,
        `setup · ${branch}`,
        prepared.command,
        undefined,
        worktreePath
      )
      termStore.setWorktreeMetadata(setupTabId, worktreePath, branch)
      const preparedTempPath = prepared.tempPath
      // Idempotent temp-file cleanup: runs on the setup PTY's exit (below) AND is
      // registered as an always-run destroy cleanup, so the temp script is never
      // leaked — including when the exit handler is cancelled because its Space
      // was deleted mid-setup (Windows %TEMP% is not auto-reaped).
      let tempCleaned = false
      const cleanupTemp = (): void => {
        if (tempCleaned) return
        tempCleaned = true
        void window.dplex.worktrees.cleanupSetupScript(preparedTempPath)
      }
      registerDestroyCleanup(setupTabId, cleanupTemp)
      registerExitHandler(setupTabId, (exitCode) => {
        void window.dplex.worktrees.recordSetupResult(originProject.path, worktreePath, exitCode)
        cleanupTemp()
        void runAfterCreate()
      })
    } catch {
      // Clean up the temp script if we failed before the exit handler could
      // be registered — otherwise the file leaks to $TMPDIR on every failure.
      if (prepared) {
        void window.dplex.worktrees.cleanupSetupScript(prepared.tempPath)
      }
      await runAfterCreate()
    }
  } else {
    await runAfterCreate()
  }

  return newProject
}
