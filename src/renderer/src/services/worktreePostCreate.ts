import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { registerExitHandler } from './terminalRegistry'
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
    createdByDplexWorktree
  } = input

  const newProject = useProjectStore.getState().addWorktreeProject({
    parentProjectId: originProject.id,
    path: worktreePath,
    branch,
    createdByDplexWorktree: createdByDplexWorktree ?? true
  })

  const termStore = useTerminalStore.getState()

  const runAfterCreate = async (): Promise<void> => {
    if (afterCreate === 'session') {
      const tabId = await useProjectStore
        .getState()
        .startAISession(newProject, providerId ?? undefined)
      if (tabId) {
        useTerminalStore.getState().setWorktreeMetadata(tabId, worktreePath, branch)
      }
    } else if (afterCreate === 'terminal') {
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
      const setupTabId = termStore.createTerminal(
        undefined,
        `setup · ${branch}`,
        prepared.command,
        undefined,
        worktreePath
      )
      termStore.setWorktreeMetadata(setupTabId, worktreePath, branch)
      const preparedTempPath = prepared.tempPath
      registerExitHandler(setupTabId, (exitCode) => {
        void window.dplex.worktrees.recordSetupResult(originProject.path, worktreePath, exitCode)
        void window.dplex.worktrees.cleanupSetupScript(preparedTempPath)
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
