import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AttentionSnapshot } from './attentionTypes'
import type { UpdateState } from './updateTypes'
import type {
  CreateWorktreeOptions,
  CreateWorktreeResult,
  DeleteWorktreeOptions,
  DeleteWorktreeResult,
  WorktreeError,
  WorktreeInfo,
  WorktreesChangedPayload
} from '../main/services/worktrees/types'
import type {
  ChangeListResult,
  CommitGraphOptions,
  CommitGraphResult,
  DiffScope,
  FileDiffContent,
  FileDiffRequest,
  HunkMutationRequest,
  MutationResult,
  RepoStatus
} from '../main/services/diff/types'
import type {
  ListDirResult,
  ReadFileResult,
  WriteFileResult,
  FsMutationResult
} from '../main/services/fsExplorer/types'
import type { DashboardMetrics } from '../main/services/dashboard/types'

export type {
  DashboardMetrics,
  HistoricalSession,
  RepoUsage,
  TimeBucket,
  HeatCell,
  ProviderSplit
} from '../main/services/dashboard/types'

export type {
  FsEntry,
  FsEntryType,
  ListDirResult,
  ReadFileResult,
  WriteFileResult,
  FsMutationResult,
  FsErrorCode
} from '../main/services/fsExplorer/types'

export type {
  CreateWorktreeOptions,
  CreateWorktreeResult,
  DeleteWorktreeOptions,
  DeleteWorktreeResult,
  WorktreeError,
  WorktreeInfo,
  WorktreesChangedPayload
} from '../main/services/worktrees/types'

export type {
  ChangedFile,
  ChangeListResult,
  CommitGraphEntry,
  CommitGraphOptions,
  CommitGraphResult,
  CommitRef,
  DiffScope,
  FileDiffContent,
  FileDiffRequest,
  GitStatusCode,
  HunkMutationRequest,
  MutationResult,
  RepoStatus,
  RepoStatusKind
} from '../main/services/diff/types'

export interface DplexAPI {
  pty: {
    create: (shell?: string, cwd?: string, command?: string) => Promise<{ id: string; pid: number }>
    write: (id: string, data: string) => void
    resize: (id: string, cols: number, rows: number) => void
    destroy: (id: string) => void
    pause: (id: string) => void
    resume: (id: string) => void
    getCwd: (id: string) => Promise<string | null>
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
  clipboard: {
    writeText: (text: string) => void
    readText: () => Promise<string>
  }
  sessions: {
    discover: (providerId?: string) => Promise<
      {
        id: string
        displayName: string
        status: string
        aiTool: string
        createdAt: string
        updatedAt: string
        cwd?: string
        summary?: string
        detailedStatus?: string
        branch?: string
        messageCount?: number
        toolCallCount?: number
        lastActivityTime?: number
      }[]
    >
    delete: (sessionId: string, providerId?: string) => Promise<void>
    close: (sessionId: string, providerId?: string) => Promise<boolean>
    loadWorkspace: () => Promise<unknown | null>
    saveWorkspace: (data: unknown) => Promise<void>
    saveWorkspaceSync: (data: unknown) => void
    resolveSessionId: (
      pid: number,
      cwd?: string,
      providerId?: string
    ) => Promise<{ sessionId: string; displayName: string } | null>
    getResumeCommand: (providerId: string, sessionId: string) => Promise<string | null>
    getNewSessionCommand: (providerId: string) => Promise<string | null>
    getProviders: () => Promise<{ id: string; name: string; command: string; icon?: string }[]>
    getPrompts: (
      sessionId: string,
      providerId?: string,
      limit?: number
    ) => Promise<{ text: string; timestamp?: number; index: number }[]>
    startWatching: () => Promise<void>
    stopWatching: () => Promise<void>
    onSessionUpdated: (
      callback: (session: {
        id: string
        displayName: string
        status: string
        aiTool: string
        createdAt: string
        updatedAt: string
        cwd?: string
        summary?: string
        detailedStatus?: string
        branch?: string
        messageCount?: number
        toolCallCount?: number
        lastActivityTime?: number
      }) => void
    ) => () => void
    onSessionAdded: (
      callback: (session: {
        id: string
        displayName: string
        status: string
        aiTool: string
        createdAt: string
        updatedAt: string
        cwd?: string
        summary?: string
        detailedStatus?: string
        branch?: string
        messageCount?: number
        toolCallCount?: number
        lastActivityTime?: number
      }) => void
    ) => () => void
    onSessionRemoved: (callback: (sessionId: string, providerId: string) => void) => () => void
  }
  settings: {
    getAll: () => Promise<Record<string, unknown>>
    setAll: (data: Record<string, unknown>) => Promise<void>
    merge: (patch: Record<string, unknown>) => Promise<void>
  }
  app: {
    getDefaultShell: () => Promise<string>
    getPlatform: () => Promise<string>
    getHomedir: () => Promise<string>
    getAvailableShells: () => Promise<{ name: string; path: string }[]>
    selectFolder: () => Promise<string | null>
    getGitBranch: (dirPath: string) => Promise<string | null>
    getVersion: () => Promise<string>
    getUpdateState: () => Promise<UpdateState>
    checkForUpdates: () => Promise<UpdateState>
    installUpdate: () => Promise<UpdateState>
    openUpdateDownload: () => Promise<UpdateState>
    onUpdateStateChanged: (cb: (state: UpdateState) => void) => () => void
  }
  git: {
    getBranch: (dirPath: string) => Promise<string | null>
    inspectPath: (dirPath: string) => Promise<{
      topLevel: string
      mainRepoPath: string
      isWorktree: boolean
      branch: string | null
    } | null>
    watchBranch: (dirPath: string) => Promise<{ token: string; repoRoot: string } | null>
    unwatchBranch: (token: string) => void
    onBranchChanged: (callback: (repoRoot: string, branch: string | null) => void) => () => void
  }
  attention: {
    getSnapshot: () => Promise<AttentionSnapshot>
    acknowledge: (compositeId: string) => void
    acknowledgeAll: () => void
    dismiss: (compositeId: string) => void
    setActiveTab: (compositeId: string | null) => void
    onUpdated: (callback: (snapshot: AttentionSnapshot) => void) => () => void
    onFocusSession: (callback: (compositeId: string) => void) => () => void
  }
  shortcuts: {
    /** Subscribe to keyboard shortcuts forwarded from the main process.
     *  Used for accelerators that collide with Chromium defaults
     *  (e.g. Ctrl+P / print) — the main process suppresses Chromium's
     *  built-in handler and re-delivers the intent here. */
    onShortcut: (callback: (id: string) => void) => () => void
  }
  worktrees: {
    list: (repoRoot: string) => Promise<WorktreeInfo[]>
    listBranches: (
      repoRoot: string
    ) => Promise<{ local: string[]; remote: string[]; defaultBase: string | null }>
    create: (opts: CreateWorktreeOptions) => Promise<CreateWorktreeResult | WorktreeError>
    delete: (opts: DeleteWorktreeOptions) => Promise<DeleteWorktreeResult | WorktreeError>
    watchRepo: (repoRoot: string) => Promise<{ token: string; repoRoot: string } | null>
    unwatchRepo: (token: string) => void
    refresh: (repoRoot: string) => Promise<void>
    reveal: (path: string) => Promise<void>
    recordSetupResult: (repoRoot: string, worktreePath: string, exitCode: number) => Promise<void>
    /**
     * Write the given script body to a temporary file and return a shell
     * command that executes it. Caller should create a PTY tab with that
     * command. A follow-up `worktrees:cleanupSetupScript` removes the tmp file.
     */
    prepareSetupScript: (scriptBody: string) => Promise<{ command: string; tempPath: string }>
    cleanupSetupScript: (tempPath: string) => Promise<void>
    onChanged: (callback: (payload: WorktreesChangedPayload) => void) => () => void
  }
  diff: {
    listChanges: (repoRootFs: string, scope: DiffScope) => Promise<ChangeListResult>
    getRepoStatus: (repoRootFs: string) => Promise<RepoStatus>
    fileContent: (req: FileDiffRequest) => Promise<FileDiffContent>
    listBranches: (repoRootFs: string) => Promise<{
      local: string[]
      remote: string[]
      defaultBase: string | null
      resolvedDefaultRef: string | null
    }>
    getCommitGraph: (repoRootFs: string, opts: CommitGraphOptions) => Promise<CommitGraphResult>
    getCommitFiles: (repoRootFs: string, sha: string) => Promise<ChangeListResult>
    stageFile: (repoRootFs: string, gitPath: string) => Promise<MutationResult>
    unstageFile: (repoRootFs: string, gitPath: string) => Promise<MutationResult>
    discardFile: (repoRootFs: string, gitPath: string) => Promise<MutationResult>
    revertFile: (repoRootFs: string, gitPath: string) => Promise<MutationResult>
    deleteUntracked: (repoRootFs: string, gitPath: string) => Promise<MutationResult>
    applyHunk: (req: HunkMutationRequest) => Promise<MutationResult>
    saveWorkingFile: (
      repoRootFs: string,
      gitPath: string,
      content: string,
      eol: '\n' | '\r\n',
      expectedMtimeMs?: number
    ) => Promise<MutationResult & { mtimeMs?: number }>
    subscribe: (repoRootFs: string) => Promise<{ token: string; repoRootFs: string } | null>
    unsubscribe: (token: string) => void
    onChangesChanged: (callback: (payload: { repoRootFs: string }) => void) => () => void
  }
  files: {
    listDir: (rootFs: string, relPath: string) => Promise<ListDirResult>
    readFile: (rootFs: string, relPath: string) => Promise<ReadFileResult>
    writeFile: (
      rootFs: string,
      relPath: string,
      content: string,
      eol: '\n' | '\r\n',
      expectedMtimeMs?: number
    ) => Promise<WriteFileResult>
    createFile: (rootFs: string, relPath: string) => Promise<FsMutationResult>
    createDir: (rootFs: string, relPath: string) => Promise<FsMutationResult>
    rename: (rootFs: string, fromRelPath: string, toRelPath: string) => Promise<FsMutationResult>
    delete: (rootFs: string, relPath: string) => Promise<FsMutationResult>
    subscribe: (rootFs: string) => Promise<{ token: string; rootFs: string } | null>
    unsubscribe: (token: string) => void
    onTreeChanged: (callback: (payload: { rootFs: string; dirs: string[] }) => void) => () => void
  }
  dashboard: {
    /** Compute the historical metrics snapshot over the given window (days). */
    getMetrics: (windowDays?: number) => Promise<DashboardMetrics>
  }
}

const dplexAPI: DplexAPI = {
  pty: {
    create: (shell?, cwd?, command?) => ipcRenderer.invoke('pty:create', shell, cwd, command),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    destroy: (id) => ipcRenderer.send('pty:destroy', id),
    pause: (id) => ipcRenderer.send('pty:pause', id),
    resume: (id) => ipcRenderer.send('pty:resume', id),
    getCwd: (id) => ipcRenderer.invoke('pty:getCwd', id),
    onData: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; data: string }
      ): void => callback(payload.id, payload.data)
      ipcRenderer.on('pty:data', handler)
      return () => ipcRenderer.removeListener('pty:data', handler)
    },
    onExit: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number }
      ): void => callback(payload.id, payload.exitCode)
      ipcRenderer.on('pty:exit', handler)
      return () => ipcRenderer.removeListener('pty:exit', handler)
    }
  },
  clipboard: {
    writeText: (text) => ipcRenderer.send('clipboard:writeText', text),
    readText: () => ipcRenderer.invoke('clipboard:readText')
  },
  sessions: {
    discover: (providerId?) => ipcRenderer.invoke('sessions:discover', providerId),
    delete: (sessionId, providerId?) =>
      ipcRenderer.invoke('sessions:delete', sessionId, providerId),
    close: (sessionId, providerId?) => ipcRenderer.invoke('sessions:close', sessionId, providerId),
    loadWorkspace: () => ipcRenderer.invoke('sessions:loadWorkspace'),
    saveWorkspace: (data) => ipcRenderer.invoke('sessions:saveWorkspace', data),
    saveWorkspaceSync: (data) => ipcRenderer.sendSync('sessions:saveWorkspaceSync', data),
    resolveSessionId: (pid, cwd?, providerId?) =>
      ipcRenderer.invoke('sessions:resolveSessionId', pid, cwd, providerId),
    getResumeCommand: (providerId, sessionId) =>
      ipcRenderer.invoke('sessions:getResumeCommand', providerId, sessionId),
    getNewSessionCommand: (providerId) =>
      ipcRenderer.invoke('sessions:getNewSessionCommand', providerId),
    getProviders: () => ipcRenderer.invoke('sessions:getProviders'),
    getPrompts: (sessionId, providerId?, limit?) =>
      ipcRenderer.invoke('sessions:getPrompts', sessionId, providerId, limit),
    startWatching: () => ipcRenderer.invoke('sessions:startWatching'),
    stopWatching: () => ipcRenderer.invoke('sessions:stopWatching'),
    onSessionUpdated: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, session: unknown): void =>
        callback(session as Parameters<typeof callback>[0])
      ipcRenderer.on('sessions:updated', handler)
      return () => ipcRenderer.removeListener('sessions:updated', handler)
    },
    onSessionAdded: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, session: unknown): void =>
        callback(session as Parameters<typeof callback>[0])
      ipcRenderer.on('sessions:added', handler)
      return () => ipcRenderer.removeListener('sessions:added', handler)
    },
    onSessionRemoved: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        sessionId: string,
        providerId: string
      ): void => callback(sessionId, providerId)
      ipcRenderer.on('sessions:removed', handler)
      return () => ipcRenderer.removeListener('sessions:removed', handler)
    }
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    setAll: (data) => ipcRenderer.invoke('settings:setAll', data),
    merge: (patch) => ipcRenderer.invoke('settings:merge', patch)
  },
  app: {
    getDefaultShell: () => ipcRenderer.invoke('app:getDefaultShell'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getHomedir: () => ipcRenderer.invoke('app:getHomedir'),
    getAvailableShells: () => ipcRenderer.invoke('app:getAvailableShells'),
    selectFolder: () => ipcRenderer.invoke('app:selectFolder'),
    getGitBranch: (dirPath: string) => ipcRenderer.invoke('app:getGitBranch', dirPath),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    openUpdateDownload: () => ipcRenderer.invoke('app:openUpdateDownload'),
    onUpdateStateChanged: (callback: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => {
        callback(state)
      }
      ipcRenderer.on('app:updateStateChanged', handler)
      return () => {
        ipcRenderer.removeListener('app:updateStateChanged', handler)
      }
    }
  },
  git: {
    getBranch: (dirPath: string) => ipcRenderer.invoke('git:getBranch', dirPath),
    inspectPath: (dirPath: string) => ipcRenderer.invoke('git:inspectPath', dirPath),
    watchBranch: (dirPath: string) => ipcRenderer.invoke('git:watchBranch', dirPath),
    unwatchBranch: (token: string) => ipcRenderer.send('git:unwatchBranch', token),
    onBranchChanged: (callback: (repoRoot: string, branch: string | null) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        repoRoot: string,
        branch: string | null
      ): void => callback(repoRoot, branch)
      ipcRenderer.on('git:branchChanged', handler)
      return () => ipcRenderer.removeListener('git:branchChanged', handler)
    }
  },
  attention: {
    getSnapshot: () => ipcRenderer.invoke('attention:getSnapshot'),
    acknowledge: (compositeId) => ipcRenderer.send('attention:acknowledge', compositeId),
    acknowledgeAll: () => ipcRenderer.send('attention:acknowledgeAll'),
    dismiss: (compositeId) => ipcRenderer.send('attention:dismiss', compositeId),
    setActiveTab: (compositeId) => ipcRenderer.send('attention:setActiveTab', compositeId),
    onUpdated: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: AttentionSnapshot): void =>
        callback(snapshot)
      ipcRenderer.on('attention:updated', handler)
      return () => ipcRenderer.removeListener('attention:updated', handler)
    },
    onFocusSession: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, compositeId: string): void =>
        callback(compositeId)
      ipcRenderer.on('attention:focusSession', handler)
      return () => ipcRenderer.removeListener('attention:focusSession', handler)
    }
  },
  shortcuts: {
    onShortcut: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
      ipcRenderer.on('dplex:shortcut', handler)
      return () => ipcRenderer.removeListener('dplex:shortcut', handler)
    }
  },
  worktrees: {
    list: (repoRoot) => ipcRenderer.invoke('worktrees:list', repoRoot),
    listBranches: (repoRoot) => ipcRenderer.invoke('worktrees:listBranches', repoRoot),
    create: (opts) => ipcRenderer.invoke('worktrees:create', opts),
    delete: (opts) => ipcRenderer.invoke('worktrees:delete', opts),
    watchRepo: (repoRoot) => ipcRenderer.invoke('worktrees:watchRepo', repoRoot),
    unwatchRepo: (token) => ipcRenderer.send('worktrees:unwatchRepo', token),
    refresh: (repoRoot) => ipcRenderer.invoke('worktrees:refresh', repoRoot),
    reveal: (path) => ipcRenderer.invoke('worktrees:reveal', path),
    recordSetupResult: (repoRoot, worktreePath, exitCode) =>
      ipcRenderer.invoke('worktrees:recordSetupResult', repoRoot, worktreePath, exitCode),
    prepareSetupScript: (scriptBody) =>
      ipcRenderer.invoke('worktrees:prepareSetupScript', scriptBody),
    cleanupSetupScript: (tempPath) => ipcRenderer.invoke('worktrees:cleanupSetupScript', tempPath),
    onChanged: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WorktreesChangedPayload): void =>
        callback(payload)
      ipcRenderer.on('worktrees:changed', handler)
      return () => ipcRenderer.removeListener('worktrees:changed', handler)
    }
  },
  diff: {
    listChanges: (repoRootFs, scope) => ipcRenderer.invoke('diff:listChanges', repoRootFs, scope),
    getRepoStatus: (repoRootFs) => ipcRenderer.invoke('diff:getRepoStatus', repoRootFs),
    fileContent: (req) => ipcRenderer.invoke('diff:fileContent', req),
    listBranches: (repoRootFs) => ipcRenderer.invoke('diff:listBranches', repoRootFs),
    getCommitGraph: (repoRootFs, opts) =>
      ipcRenderer.invoke('diff:getCommitGraph', repoRootFs, opts),
    getCommitFiles: (repoRootFs, sha) => ipcRenderer.invoke('diff:getCommitFiles', repoRootFs, sha),
    stageFile: (repoRootFs, gitPath) => ipcRenderer.invoke('diff:stageFile', repoRootFs, gitPath),
    unstageFile: (repoRootFs, gitPath) =>
      ipcRenderer.invoke('diff:unstageFile', repoRootFs, gitPath),
    discardFile: (repoRootFs, gitPath) =>
      ipcRenderer.invoke('diff:discardFile', repoRootFs, gitPath),
    revertFile: (repoRootFs, gitPath) => ipcRenderer.invoke('diff:revertFile', repoRootFs, gitPath),
    deleteUntracked: (repoRootFs, gitPath) =>
      ipcRenderer.invoke('diff:deleteUntracked', repoRootFs, gitPath),
    applyHunk: (req) => ipcRenderer.invoke('diff:applyHunk', req),
    saveWorkingFile: (repoRootFs, gitPath, content, eol, expectedMtimeMs) =>
      ipcRenderer.invoke(
        'diff:saveWorkingFile',
        repoRootFs,
        gitPath,
        content,
        eol,
        expectedMtimeMs
      ),
    subscribe: (repoRootFs) => ipcRenderer.invoke('diff:subscribe', repoRootFs),
    unsubscribe: (token) => ipcRenderer.send('diff:unsubscribe', token),
    onChangesChanged: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { repoRootFs: string }): void =>
        callback(payload)
      ipcRenderer.on('git:diff:changes-changed', handler)
      return () => ipcRenderer.removeListener('git:diff:changes-changed', handler)
    }
  },
  files: {
    listDir: (rootFs, relPath) => ipcRenderer.invoke('files:listDir', rootFs, relPath),
    readFile: (rootFs, relPath) => ipcRenderer.invoke('files:readFile', rootFs, relPath),
    writeFile: (rootFs, relPath, content, eol, expectedMtimeMs) =>
      ipcRenderer.invoke('files:writeFile', rootFs, relPath, content, eol, expectedMtimeMs),
    createFile: (rootFs, relPath) => ipcRenderer.invoke('files:createFile', rootFs, relPath),
    createDir: (rootFs, relPath) => ipcRenderer.invoke('files:createDir', rootFs, relPath),
    rename: (rootFs, fromRelPath, toRelPath) =>
      ipcRenderer.invoke('files:rename', rootFs, fromRelPath, toRelPath),
    delete: (rootFs, relPath) => ipcRenderer.invoke('files:delete', rootFs, relPath),
    subscribe: (rootFs) => ipcRenderer.invoke('files:subscribe', rootFs),
    unsubscribe: (token) => ipcRenderer.send('files:unsubscribe', token),
    onTreeChanged: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { rootFs: string; dirs: string[] }
      ): void => callback(payload)
      ipcRenderer.on('files:tree-changed', handler)
      return () => ipcRenderer.removeListener('files:tree-changed', handler)
    }
  },
  dashboard: {
    getMetrics: (windowDays) => ipcRenderer.invoke('dashboard:getMetrics', windowDays)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('dplex', dplexAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.dplex = dplexAPI
}
