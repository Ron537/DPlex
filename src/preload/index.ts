import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface DplexAPI {
  pty: {
    create: (shell?: string, cwd?: string, command?: string) => Promise<{ id: string; pid: number }>
    write: (id: string, data: string) => void
    resize: (id: string, cols: number, rows: number) => void
    destroy: (id: string) => void
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
  sessions: {
    discover: (providerId?: string) => Promise<unknown[]>
    delete: (sessionId: string, providerId?: string) => Promise<void>
    close: (sessionId: string, providerId?: string) => Promise<boolean>
    checkStatuses: (projectPaths: string[]) => Promise<{ id: string; displayName: string; cwd: string; aiTool: string }[]>
    loadWorkspace: () => Promise<unknown | null>
    saveWorkspace: (data: unknown) => Promise<void>
    saveWorkspaceSync: (data: unknown) => void
    resolveSessionId: (pid: number, cwd?: string) => Promise<{ sessionId: string; displayName: string } | null>
    getResumeCommand: (providerId: string, sessionId: string) => Promise<string | null>
    getNewSessionCommand: (providerId: string) => Promise<string | null>
    getProviders: () => Promise<{ id: string; name: string; command: string }[]>
  }
  settings: {
    getAll: () => Promise<Record<string, unknown>>
    setAll: (data: Record<string, unknown>) => Promise<void>
  }
  app: {
    getDefaultShell: () => Promise<string>
    getPlatform: () => Promise<string>
    getHomedir: () => Promise<string>
    getAvailableShells: () => Promise<{ name: string; path: string }[]>
    selectFolder: () => Promise<string | null>
    getGitBranch: (dirPath: string) => Promise<string | null>
  }
}

const dplexAPI: DplexAPI = {
  pty: {
    create: (shell?, cwd?, command?) => ipcRenderer.invoke('pty:create', shell, cwd, command),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    destroy: (id) => ipcRenderer.send('pty:destroy', id),
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
  sessions: {
    discover: (providerId?) => ipcRenderer.invoke('sessions:discover', providerId),
    delete: (sessionId, providerId?) => ipcRenderer.invoke('sessions:delete', sessionId, providerId),
    close: (sessionId, providerId?) => ipcRenderer.invoke('sessions:close', sessionId, providerId),
    checkStatuses: (projectPaths) => ipcRenderer.invoke('sessions:getActiveForProjects', projectPaths),
    loadWorkspace: () => ipcRenderer.invoke('sessions:loadWorkspace'),
    saveWorkspace: (data) => ipcRenderer.invoke('sessions:saveWorkspace', data),
    saveWorkspaceSync: (data) => ipcRenderer.sendSync('sessions:saveWorkspaceSync', data),
    resolveSessionId: (pid, cwd?) => ipcRenderer.invoke('sessions:resolveSessionId', pid, cwd),
    getResumeCommand: (providerId, sessionId) => ipcRenderer.invoke('sessions:getResumeCommand', providerId, sessionId),
    getNewSessionCommand: (providerId) => ipcRenderer.invoke('sessions:getNewSessionCommand', providerId),
    getProviders: () => ipcRenderer.invoke('sessions:getProviders')
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    setAll: (data) => ipcRenderer.invoke('settings:setAll', data)
  },
  app: {
    getDefaultShell: () => ipcRenderer.invoke('app:getDefaultShell'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getHomedir: () => ipcRenderer.invoke('app:getHomedir'),
    getAvailableShells: () => ipcRenderer.invoke('app:getAvailableShells'),
    selectFolder: () => ipcRenderer.invoke('app:selectFolder'),
    getGitBranch: (dirPath: string) => ipcRenderer.invoke('app:getGitBranch', dirPath)
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
