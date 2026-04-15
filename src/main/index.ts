import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as os from 'os'
import icon from '../../resources/icon.png?asset'
import {
  createPty,
  writePty,
  resizePty,
  destroyPty,
  destroyAllPtys,
  destroyPtysForWindow,
  getDefaultShellPath,
  discoverAvailableShells
} from './services/ptyManager'
import { createDefaultRegistry } from './services/providers'
import { loadWorkspace, saveWorkspace, type PersistedWorkspace } from './services/sessionPersistence'
import { handleSessionNotification, clearNotificationState, seedNotificationState } from './services/notifications'
import { getBranch, watchBranch, unwatchBranch, stopAllBranchWatchers } from './services/gitService'

const providerRegistry = createDefaultRegistry()

const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json')

let mainWindow: BrowserWindow | null = null

function loadSettings(): Record<string, unknown> {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
    }
  } catch {
    // Ignore parse errors
  }
  return {}
}

function saveSettings(data: Record<string, unknown>): void {
  const tmpPath = SETTINGS_PATH + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  fs.renameSync(tmpPath, SETTINGS_PATH)
}

function mergeSettings(patch: Record<string, unknown>): void {
  const current = loadSettings()
  saveSettings({ ...current, ...patch })
}

function createWindow(): void {
  // Read saved theme to set correct initial window background
  const savedSettings = loadSettings()
  const savedTheme = (savedSettings.theme as string) || 'midnight'
  // Map theme ID to its UI background color
  const themeBgMap: Record<string, string> = {
    'midnight': '#1a1a2e',
    'dracula': '#282a36',
    'monokai': '#272822',
    'nord': '#2e3440',
    'solarized-dark': '#002b36',
    'github-dark': '#0d1117',
    'github-light': '#ffffff',
    'solarized-light': '#fdf6e3',
    'quiet-light': '#f5f5f5'
  }
  const windowBg = themeBgMap[savedTheme] || '#1a1a2e'

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    autoHideMenuBar: true,
    backgroundColor: windowBg,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    // Stop all provider watchers — on macOS the app stays alive after window close
    for (const provider of providerRegistry.getAllProviders()) {
      provider.stopWatching()
    }
    stopAllBranchWatchers()
    if (mainWindow) {
      destroyPtysForWindow(mainWindow.id)
    }
    mainWindow = null
  })

  // Clean up PTYs if renderer crashes
  mainWindow.webContents.on('render-process-gone', () => {
    if (mainWindow) {
      destroyPtysForWindow(mainWindow.id)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  // PTY management — create returns { id, pid }
  ipcMain.handle('pty:create', (_event, shell?: string, cwd?: string, command?: string) => {
    if (!mainWindow) throw new Error('No window')
    return createPty(mainWindow, shell, cwd, command)
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    writePty(id, data)
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    resizePty(id, cols, rows)
  })

  ipcMain.on('pty:destroy', (_event, id: string) => {
    destroyPty(id)
  })

  // Session discovery — routes through provider registry
  ipcMain.handle('sessions:discover', (_event, providerId?: string) => {
    return providerRegistry.discoverSessions(providerId)
  })

  ipcMain.handle('sessions:delete', async (_event, sessionId: string, providerId?: string) => {
    await providerRegistry.deleteSession(sessionId, providerId)
    clearNotificationState(sessionId)
  })

  ipcMain.handle('sessions:close', (_event, sessionId: string, providerId?: string) => {
    return providerRegistry.closeSession(sessionId, providerId)
  })

  // Provider-aware commands
  ipcMain.handle('sessions:getResumeCommand', (_event, providerId: string, sessionId: string) => {
    return providerRegistry.getResumeCommand(providerId, sessionId)
  })

  ipcMain.handle('sessions:getNewSessionCommand', (_event, providerId: string) => {
    return providerRegistry.getNewSessionCommand(providerId)
  })

  ipcMain.handle('sessions:getProviders', () => {
    return providerRegistry.getProviderInfoList()
  })

  // Session watching — start/stop watchers, push events to renderer
  ipcMain.handle('sessions:startWatching', async () => {
    const sendToRenderer = (channel: string, ...args: unknown[]): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args)
      }
    }

    for (const provider of providerRegistry.getAllProviders()) {
      await provider.startWatching({
        onUpdated: (session) => {
          handleSessionNotification(session)
          sendToRenderer('sessions:updated', session)
        },
        onAdded: (session) => {
          seedNotificationState(session)
          sendToRenderer('sessions:added', session)
        },
        onRemoved: (sessionId, providerId) => {
          sendToRenderer('sessions:removed', sessionId, providerId)
        }
      })
    }
  })

  ipcMain.handle('sessions:stopWatching', () => {
    for (const provider of providerRegistry.getAllProviders()) {
      provider.stopWatching()
    }
  })

  // Prompt extraction
  ipcMain.handle(
    'sessions:getPrompts',
    async (_event, sessionId: string, providerId?: string, limit?: number) => {
      if (providerId) {
        const provider = providerRegistry.getProvider(providerId)
        if (provider) return provider.getPrompts(sessionId, limit)
        return []
      }
      // Try all providers
      for (const provider of providerRegistry.getAllProviders()) {
        const prompts = await provider.getPrompts(sessionId, limit)
        if (prompts.length > 0) return prompts
      }
      return []
    }
  )

  // Workspace persistence
  ipcMain.handle('sessions:loadWorkspace', () => loadWorkspace())
  ipcMain.handle('sessions:saveWorkspace', (_event, data: PersistedWorkspace) => {
    saveWorkspace(data)
  })
  // Sync version for reliable save on quit (blocks until written)
  ipcMain.on('sessions:saveWorkspaceSync', (event, data: PersistedWorkspace) => {
    saveWorkspace(data)
    event.returnValue = true
  })
  ipcMain.handle('sessions:resolveSessionId', async (_event, pid: number, cwd?: string) => {
    // Try PID match first (most reliable), then CWD fallback — across all providers
    const pidResult = await providerRegistry.resolveSessionByPid(pid)
    if (pidResult) return pidResult
    if (cwd) return providerRegistry.resolveSessionByCwd(cwd)
    return null
  })

  // Settings
  ipcMain.handle('settings:getAll', () => loadSettings())
  ipcMain.handle('settings:setAll', (_event, data: Record<string, unknown>) => {
    saveSettings(data)
  })
  ipcMain.handle('settings:merge', (_event, patch: Record<string, unknown>) => {
    mergeSettings(patch)
  })

  // App info
  ipcMain.handle('app:getDefaultShell', () => getDefaultShellPath())
  ipcMain.handle('app:getPlatform', () => process.platform)
  ipcMain.handle('app:getHomedir', () => os.homedir())
  ipcMain.handle('app:getAvailableShells', () => discoverAvailableShells())

  // Folder picker
  ipcMain.handle('app:selectFolder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Project Folder'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Git branch for a directory (legacy — kept for backward compatibility)
  ipcMain.handle('app:getGitBranch', async (_event, dirPath: string) => {
    return getBranch(dirPath)
  })

  // Git service — reactive branch watching
  ipcMain.handle('git:getBranch', async (_event, dirPath: string) => {
    return getBranch(dirPath)
  })

  // Track per-subscription callback references — keyed by dirPath to support
  // multiple projects in the same repo without overwriting each other
  const gitWatchCallbacks = new Map<string, {
    repoRoot: string
    callback: (repoRoot: string, branch: string | null) => void
  }>()

  // Single shared callback that forwards to renderer
  const sendBranchChange = (repoRoot: string, branch: string | null): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('git:branchChanged', repoRoot, branch)
    }
  }

  ipcMain.handle('git:watchBranch', async (_event, dirPath: string) => {
    // If already watching this exact dirPath, just return the repo root
    const existing = gitWatchCallbacks.get(dirPath)
    if (existing) return existing.repoRoot

    const callback = (root: string, branch: string | null): void => {
      sendBranchChange(root, branch)
    }

    const repoRoot = await watchBranch(dirPath, callback)
    if (repoRoot) {
      gitWatchCallbacks.set(dirPath, { repoRoot, callback })
    }
    return repoRoot
  })

  ipcMain.on('git:unwatchBranch', (_event, repoRoot: string) => {
    // Find and remove all subscriptions for this repo root
    for (const [dirPath, entry] of gitWatchCallbacks) {
      if (entry.repoRoot === repoRoot) {
        unwatchBranch(repoRoot, entry.callback)
        gitWatchCallbacks.delete(dirPath)
      }
    }
  })
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dplex')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  for (const provider of providerRegistry.getAllProviders()) {
    provider.stopWatching()
  }
  stopAllBranchWatchers()
  destroyAllPtys()
})
