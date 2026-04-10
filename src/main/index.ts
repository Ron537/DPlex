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
import { discoverCopilotSessions, deleteSessionDir, checkSessionStatuses } from './services/sessionDiscovery'

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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2))
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
    'github-dark': '#0d1117'
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
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
  // PTY management — create returns the generated ID
  ipcMain.handle('pty:create', (_event, shell?: string, cwd?: string) => {
    if (!mainWindow) throw new Error('No window')
    return createPty(mainWindow, shell, cwd)
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

  // Session discovery
  ipcMain.handle('sessions:discover', () => {
    return discoverCopilotSessions()
  })

  ipcMain.handle('sessions:delete', (_event, sessionId: string) => {
    return deleteSessionDir(sessionId)
  })

  ipcMain.handle('sessions:checkStatuses', (_event, projectPaths: string[]) => {
    return checkSessionStatuses(projectPaths)
  })

  // Settings
  ipcMain.handle('settings:getAll', () => loadSettings())
  ipcMain.handle('settings:setAll', (_event, data: Record<string, unknown>) => {
    saveSettings(data)
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

  // Git branch for a directory (async to avoid blocking main process)
  ipcMain.handle('app:getGitBranch', async (_event, dirPath: string) => {
    try {
      const { execFile } = await import('child_process')
      return new Promise<string | null>((resolve) => {
        execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: dirPath,
          timeout: 3000
        }, (err, stdout) => {
          if (err) return resolve(null)
          resolve(stdout.trim() || null)
        })
      })
    } catch {
      return null
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
  destroyAllPtys()
})
