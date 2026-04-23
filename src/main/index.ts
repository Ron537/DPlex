import { app, shell, BrowserWindow, ipcMain, dialog, nativeImage } from 'electron'
import { join } from 'path'
import * as path from 'path'
import { randomUUID } from 'crypto'
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
import { BaseSessionProvider } from './services/providers/baseProvider'
import { loadWorkspace, saveWorkspace, type PersistedWorkspace } from './services/sessionPersistence'
import {
  applyNotificationSettings,
  clearNotificationState,
  handleAttentionEvent,
  setFocusSessionCallback,
  clearFocusSessionCallback,
  setActiveCompositeId
} from './services/notifications'
import * as attentionService from './services/attentionService'
import { makeCompositeId } from '../preload/attentionTypes'
import {
  getBranch,
  watchBranch,
  unwatchBranch,
  stopAllBranchWatchers,
  inspectPath
} from './services/gitService'
import * as worktreeService from './services/worktrees'
import type {
  CreateWorktreeOptions,
  DeleteWorktreeOptions
} from './services/worktrees/types'

const providerRegistry = createDefaultRegistry()

// Bridge attention service → notifications + renderer.
// Registered once at module load; listeners are module-level singletons.
attentionService.onNewAttentionEvent((event) => {
  handleAttentionEvent(event)
})
attentionService.onEscalation((event) => {
  handleAttentionEvent(event)
})
attentionService.onSnapshotChanged((snapshot) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('attention:updated', snapshot)
  }
})

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
  const next = { ...current, ...patch }
  saveSettings(next)
  applySettingsToServices(next)
}

function applySettingsToServices(settings: Record<string, unknown>): void {
  const maxAge = settings.sessionMaxAgeDays
  if (typeof maxAge === 'number') {
    BaseSessionProvider.setMaxAgeDays(maxAge)
  }

  const notificationPatch: Record<string, unknown> = {}
  if (typeof settings.notificationsEnabled === 'boolean') {
    notificationPatch.enabled = settings.notificationsEnabled
  }
  if (typeof settings.notifyOnApproval === 'boolean') {
    notificationPatch.notifyOnApproval = settings.notifyOnApproval
  }
  if (typeof settings.notifyOnInput === 'boolean') {
    notificationPatch.notifyOnInput = settings.notifyOnInput
  }
  if (typeof settings.notifyOnFinished === 'boolean') {
    notificationPatch.notifyOnFinished = settings.notifyOnFinished
  }
  if (typeof settings.notifyOnlyWhenUnfocused === 'boolean') {
    notificationPatch.onlyWhenUnfocused = settings.notifyOnlyWhenUnfocused
  }
  if (typeof settings.notificationSound === 'boolean') {
    notificationPatch.sound = settings.notificationSound
  }
  if (typeof settings.dndFrom === 'string' || settings.dndFrom === null) {
    notificationPatch.dndFrom = settings.dndFrom ?? null
  }
  if (typeof settings.dndTo === 'string' || settings.dndTo === null) {
    notificationPatch.dndTo = settings.dndTo ?? null
  }
  if (typeof settings.notificationCooldownSeconds === 'number') {
    notificationPatch.cooldownSeconds = Math.max(0, settings.notificationCooldownSeconds)
  }
  if (Object.keys(notificationPatch).length > 0) {
    applyNotificationSettings(
      notificationPatch as Partial<Parameters<typeof applyNotificationSettings>[0]>
    )
  }

  const idleMinutes = settings.idleTooLongMinutes
  if (typeof idleMinutes === 'number' && idleMinutes > 0) {
    attentionService.setIdleThresholdMinutes(idleMinutes)
  }
}

// Apply persisted settings to backend services at startup
applySettingsToServices(loadSettings())

function createWindow(): void {
  // Read saved theme to set correct initial window background
  const savedSettings = loadSettings()
  const savedTheme = (savedSettings.theme as string) || 'dplex'
  // Map theme ID to its UI background color
  const themeBgMap: Record<string, string> = {
    'dplex': '#131313',
    'dplex-light': '#fafafa',
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
  const windowBg = themeBgMap[savedTheme] || '#131313'

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
    icon,
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

  // Wire notification click → renderer focus-session intent.
  // Re-registered on every window creation so the current mainWindow receives it.
  setFocusSessionCallback((compositeId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('attention:focusSession', compositeId)
    }
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
    // Clear focus callback so notification clicks queue until a new window exists
    clearFocusSessionCallback()
    mainWindow = null
  })

  // Clean up PTYs if renderer crashes
  mainWindow.webContents.on('render-process-gone', () => {
    if (mainWindow) {
      destroyPtysForWindow(mainWindow.id)
    }
  })

  // Harden external link handling: shell.openExternal will happily dispatch
  // any URL scheme to the OS handler — including dangerous ones like `file:`,
  // `javascript:`, or OS-registered protocol handlers (e.g. `ms-excel:`) that
  // can trigger arbitrary file reads or code execution. Restrict to HTTP(S)
  // and mailto so a stray link surfaced by xterm.js or a renderer XSS can't
  // escalate to local-code execution.
  const isSafeExternalUrl = (rawUrl: string): boolean => {
    try {
      const u = new URL(rawUrl)
      return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
    } catch {
      return false
    }
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // Block in-window navigation entirely. The renderer should never leave the
  // app bundle — any `target=_self` link or accidental `window.location`
  // assignment must not navigate the main window away from the app.
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? ''
    if (targetUrl === currentUrl) return
    event.preventDefault()
    if (isSafeExternalUrl(targetUrl)) {
      shell.openExternal(targetUrl)
    }
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
    if (providerId) {
      const compositeId = makeCompositeId(providerId, sessionId)
      clearNotificationState(compositeId)
      attentionService.forgetSession(compositeId)
    } else {
      // providerId unknown — sweep every attention entry matching this bare id
      const removed = attentionService.forgetSessionsByBareId(sessionId)
      for (const cid of removed) clearNotificationState(cid)
    }
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

    // First pass: seed attention state from already-discovered sessions without
    // firing notifications. This avoids spurious notifications for sessions
    // that were already in a waiting state before DPlex started.
    try {
      const initial = await providerRegistry.discoverSessions()
      for (const session of initial) {
        attentionService.seedDiscoveredSession(session)
      }
    } catch {
      // Non-fatal — watchers below will still pick up state changes.
    }

    for (const provider of providerRegistry.getAllProviders()) {
      await provider.startWatching({
        onUpdated: (session) => {
          attentionService.ingestSessionUpdate(session)
          sendToRenderer('sessions:updated', session)
        },
        onAdded: (session) => {
          attentionService.addDiscoveredSession(session)
          sendToRenderer('sessions:added', session)
        },
        onRemoved: (sessionId, providerId) => {
          const compositeId = makeCompositeId(providerId, sessionId)
          clearNotificationState(compositeId)
          attentionService.forgetSession(compositeId)
          sendToRenderer('sessions:removed', sessionId, providerId)
        }
      })
    }

    attentionService.startIdleSweeper()
  })

  ipcMain.handle('sessions:stopWatching', () => {
    for (const provider of providerRegistry.getAllProviders()) {
      provider.stopWatching()
    }
    attentionService.stopIdleSweeper()
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
    applySettingsToServices(data)
  })
  ipcMain.handle('settings:merge', (_event, patch: Record<string, unknown>) => {
    mergeSettings(patch)
  })

  // Attention inbox
  ipcMain.handle('attention:getSnapshot', () => attentionService.currentSnapshot())
  ipcMain.on('attention:acknowledge', (_event, compositeId: string) => {
    attentionService.acknowledge(compositeId)
  })
  ipcMain.on('attention:acknowledgeAll', () => {
    attentionService.acknowledgeAll()
  })
  ipcMain.on('attention:dismiss', (_event, compositeId: string) => {
    attentionService.dismiss(compositeId)
  })
  ipcMain.on('attention:setActiveTab', (_event, compositeId: string | null) => {
    setActiveCompositeId(compositeId)
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

  ipcMain.handle('git:inspectPath', async (_event, dirPath: string) => {
    return inspectPath(dirPath)
  })

  // Track per-subscription callback references — keyed by TOKEN so that
  // multiple renderer-side consumers can watch the same repoRoot without
  // tearing each other's subscriptions down on unwatch.
  const gitWatchCallbacks = new Map<
    string,
    { repoRoot: string; callback: (repoRoot: string, branch: string | null) => void }
  >()
  // Per-webContents token set so we can tear everything down if the renderer
  // reloads/crashes before git:unwatchBranch is called.
  const gitWatchTokensByWebContents = new Map<number, Set<string>>()

  const teardownGitWatchToken = (token: string): void => {
    const entry = gitWatchCallbacks.get(token)
    if (!entry) return
    gitWatchCallbacks.delete(token)
    unwatchBranch(entry.repoRoot, entry.callback)
  }

  ipcMain.handle('git:watchBranch', async (event, dirPath: string) => {
    const sender = event.sender
    const wcId = sender.id

    // Install destroyed handler BEFORE awaiting so a reload/crash during
    // watchBranch() still tears everything down.
    let set = gitWatchTokensByWebContents.get(wcId)
    if (!set) {
      set = new Set()
      gitWatchTokensByWebContents.set(wcId, set)
      sender.once('destroyed', () => {
        const tokens = gitWatchTokensByWebContents.get(wcId)
        gitWatchTokensByWebContents.delete(wcId)
        if (tokens) for (const t of tokens) teardownGitWatchToken(t)
      })
    }

    const callback = (root: string, branch: string | null): void => {
      if (!sender.isDestroyed()) {
        sender.send('git:branchChanged', root, branch)
      }
    }
    const repoRoot = await watchBranch(dirPath, callback)
    if (!repoRoot) return null
    if (sender.isDestroyed()) {
      unwatchBranch(repoRoot, callback)
      return null
    }
    const token = randomUUID()
    gitWatchCallbacks.set(token, { repoRoot, callback })
    set.add(token)
    return { token, repoRoot }
  })

  ipcMain.on('git:unwatchBranch', (event, token: string) => {
    teardownGitWatchToken(token)
    const set = gitWatchTokensByWebContents.get(event.sender.id)
    if (set) set.delete(token)
  })

  // ── Worktrees ──────────────────────────────────────────────────────
  // Track subscription tokens per webContents so we can clean up on reload/close.
  const worktreeSubsByWebContents = new Map<number, Set<string>>()

  ipcMain.handle('worktrees:list', (_event, repoRoot: string) => {
    return worktreeService.list(repoRoot)
  })

  ipcMain.handle('worktrees:listBranches', (_event, repoRoot: string) => {
    return worktreeService.listBranches(repoRoot)
  })

  ipcMain.handle('worktrees:create', (_event, opts: CreateWorktreeOptions) => {
    return worktreeService.create(opts)
  })

  ipcMain.handle('worktrees:delete', (_event, opts: DeleteWorktreeOptions) => {
    return worktreeService.remove(opts)
  })

  ipcMain.handle('worktrees:watchRepo', async (event, repoRoot: string) => {
    const sender = event.sender
    const wcId = sender.id

    // Register the destroyed handler BEFORE awaiting so that if the
    // webContents dies while watchRepo is resolving, the token we're about
    // to create is still torn down.
    let set = worktreeSubsByWebContents.get(wcId)
    if (!set) {
      set = new Set()
      worktreeSubsByWebContents.set(wcId, set)
      sender.once('destroyed', () => {
        const tokens = worktreeSubsByWebContents.get(wcId)
        worktreeSubsByWebContents.delete(wcId)
        if (tokens) {
          for (const t of tokens) worktreeService.unwatchRepo(t)
        }
      })
    }

    const result = await worktreeService.watchRepo(repoRoot, (payload) => {
      if (!sender.isDestroyed()) {
        sender.send('worktrees:changed', payload)
      }
    })
    if (!result) return null

    // If the webContents died during the await, unwatch immediately.
    if (sender.isDestroyed()) {
      worktreeService.unwatchRepo(result.token)
      return null
    }

    set.add(result.token)
    return result
  })

  ipcMain.on('worktrees:unwatchRepo', (event, token: string) => {
    worktreeService.unwatchRepo(token)
    const set = worktreeSubsByWebContents.get(event.sender.id)
    if (set) set.delete(token)
  })

  ipcMain.handle('worktrees:refresh', (_event, repoRoot: string) => {
    return worktreeService.refreshRepo(repoRoot)
  })

  ipcMain.handle('worktrees:reveal', async (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle(
    'worktrees:recordSetupResult',
    async (_event, repoRoot: string, worktreePath: string, exitCode: number) => {
      await worktreeService.recordSetupResult(repoRoot, worktreePath, exitCode)
    }
  )

  ipcMain.handle('worktrees:prepareSetupScript', async (_event, scriptBody: string) => {
    const isWindows = process.platform === 'win32'
    const ext = isWindows ? '.bat' : '.sh'
    const tempPath = join(os.tmpdir(), `dplex-setup-${randomUUID()}${ext}`)
    const body = isWindows
      ? `@echo off\r\n${scriptBody.replace(/\r?\n/g, '\r\n')}\r\n`
      : `#!/bin/sh\nset -e\n${scriptBody}\n`
    await fs.promises.writeFile(tempPath, body, { mode: 0o700 })
    // Windows cmd.exe /C parses outer quotes specially: if both the command
    // and args are quoted, it strips the outermost pair. Wrap the path in a
    // second pair so paths with spaces (e.g. C:\Users\John Doe\...) work.
    const command = isWindows
      ? `cmd /c ""${tempPath}""`
      : `sh "${tempPath.replace(/"/g, '\\"')}"`
    return { command, tempPath }
  })

  ipcMain.handle('worktrees:cleanupSetupScript', async (_event, tempPath: string) => {
    try {
      const tmpRoot = await fs.promises.realpath(os.tmpdir())
      const resolved = await fs.promises.realpath(tempPath).catch(() => null)
      if (!resolved) return
      // Use path.relative for boundary-safe containment check — rejects paths
      // that only share the tmpdir prefix as a string (e.g. /tmpfoo vs /tmp).
      const rel = path.relative(tmpRoot, resolved)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return
      await fs.promises.unlink(resolved).catch(() => undefined)
    } catch {
      /* ignore */
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

  // Set dock icon on macOS (dev mode shows Electron's default otherwise)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

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
  worktreeService.stopAll()
  destroyAllPtys()
})
