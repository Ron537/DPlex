import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface DplexAPI {
  pty: {
    create: (shell?: string, cwd?: string) => Promise<string>
    write: (id: string, data: string) => void
    resize: (id: string, cols: number, rows: number) => void
    destroy: (id: string) => void
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
  sessions: {
    discover: () => Promise<unknown[]>
    delete: (sessionId: string) => Promise<void>
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
    create: (shell?, cwd?) => ipcRenderer.invoke('pty:create', shell, cwd),
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
    discover: () => ipcRenderer.invoke('sessions:discover'),
    delete: (sessionId) => ipcRenderer.invoke('sessions:delete', sessionId)
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
