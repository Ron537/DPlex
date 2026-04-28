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
import {
  loadWorkspace,
  saveWorkspace,
  type PersistedWorkspace
} from './services/sessionPersistence'
import {
  applyNotificationSettings,
  clearNotificationState,
  handleAttentionEvent,
  setFocusSessionCallback,
  clearFocusSessionCallback,
  setActiveCompositeId
} from './services/notifications'
import * as attentionService from './services/attentionService'
import { initAutoUpdater } from './services/autoUpdater'
import { makeCompositeId } from '../preload/attentionTypes'
import {
  getBranch,
  getRepoRoot,
  watchBranch,
  unwatchBranch,
  stopAllBranchWatchers,
  inspectPath,
  listLocalBranches,
  listRemoteBranches,
  resolveDefaultBaseBranch
} from './services/gitService'
import * as worktreeService from './services/worktrees'
import {
  fileDiffContent as diffFileContent,
  getRepoStatus as diffGetRepoStatus,
  listChanges as diffListChanges,
  resolveBranchBase
} from './services/diff/diffService'
import {
  applyHunkPatch,
  deleteUntracked,
  discardFile,
  revertFile,
  sanitizeGitPath,
  stageFile,
  unstageFile
} from './services/diff/scmMutations'
import {
  subscribeChanges as subscribeDiffChanges,
  unsubscribeChanges as unsubscribeDiffChanges,
  type ChangesSubscriptionToken
} from './services/diff/changesWatcher'
import type { DiffScope, FileDiffRequest, HunkMutationRequest } from './services/diff/types'
import type { CreateWorktreeOptions, DeleteWorktreeOptions } from './services/worktrees/types'

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
    dplex: '#131313',
    'dplex-light': '#fafafa',
    midnight: '#1a1a2e',
    dracula: '#282a36',
    monokai: '#272822',
    nord: '#2e3440',
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
  ipcMain.handle(
    'sessions:resolveSessionId',
    async (_event, pid: number, cwd?: string, providerId?: string) => {
      // Try PID match first (most reliable), then CWD fallback. When the
      // caller knows the tab's providerId, we scope the lookup to that
      // provider only — preventing a Claude tab from being associated with
      // a Copilot session (or vice versa) when both providers have active
      // sessions in the same cwd. Cross-provider contamination produced
      // duplicate rows + wrong tab focus in the project list.
      const pidResult = await providerRegistry.resolveSessionByPid(pid, providerId)
      if (pidResult) return pidResult
      if (cwd) return providerRegistry.resolveSessionByCwd(cwd, providerId)
      return null
    }
  )

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
    const command = isWindows ? `cmd /c ""${tempPath}""` : `sh "${tempPath.replace(/"/g, '\\"')}"`
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

  registerDiffHandlers()
}

/** Map of webContents.id → set of diff subscription tokens for cleanup. */
const diffSubsByWebContents = new Map<number, Set<ChangesSubscriptionToken>>()
const diffTokensById = new Map<string, ChangesSubscriptionToken>()

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/**
 * Realpath + sanity-check a renderer-supplied repo root. Resolves the input
 * to the *containing* repo's top-level directory so projects added as a
 * subfolder of a repo (e.g. a monorepo package) still work for diff/listChanges/
 * subscribe. Returns `null` for paths not under any git repo.
 */
async function safeRepoRoot(input: unknown): Promise<string | null> {
  if (typeof input !== 'string' || input.length === 0) return null
  try {
    const real = await fs.promises.realpath(input)
    const stat = await fs.promises.stat(real)
    if (!stat.isDirectory()) return null
    // Fast path: the input itself is the repo root (regular repo or
    // worktree — both have a `.git` entry, file or dir).
    const gitStat = await fs.promises.stat(path.join(real, '.git')).catch(() => null)
    if (gitStat) return real
    // Slow path: project is a subfolder of a repo. Climb up via git CLI.
    const root = await getRepoRoot(real)
    if (!root) return null
    return await fs.promises.realpath(root).catch(() => root)
  } catch {
    return null
  }
}

/**
 * Looser variant of {@link safeRepoRoot} for repo-status probing.
 * Accepts any existing directory (including non-git ones), so the renderer
 * can ask "is this even a git repo?" and get a structured answer back.
 * Returns null only for invalid/non-existent paths.
 */
async function safeExistingDir(input: unknown): Promise<string | null> {
  if (typeof input !== 'string' || input.length === 0) return null
  try {
    const real = await fs.promises.realpath(input)
    const stat = await fs.promises.stat(real)
    if (!stat.isDirectory()) return null
    return real
  } catch {
    return null
  }
}

function safeScope(input: unknown): DiffScope | null {
  if (!isPlainObject(input)) return null
  if (input.kind === 'workingTree') return { kind: 'workingTree' }
  if (input.kind === 'branch' && typeof input.base === 'string' && input.base.length > 0) {
    // Defense-in-depth: reject ref names that begin with `-` or contain NUL —
    // git's CLI would interpret them as options. Also reject leading whitespace
    // for the same reason.
    if (/^[\s-]/.test(input.base) || input.base.includes('\0')) return null
    let resolvedRef: string | undefined
    if (typeof input.resolvedRef === 'string') {
      if (/^[\s-]/.test(input.resolvedRef) || input.resolvedRef.includes('\0')) return null
      resolvedRef = input.resolvedRef
    }
    return {
      kind: 'branch',
      base: input.base,
      resolvedRef
    }
  }
  return null
}

function registerDiffHandlers(): void {
  ipcMain.handle('diff:listChanges', async (_event, repoRootFs: unknown, scope: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    const safeScopeVal = safeScope(scope)
    if (!root || !safeScopeVal) return { files: [], truncated: false, totalCount: 0 }
    return diffListChanges(root, safeScopeVal)
  })

  ipcMain.handle('diff:getRepoStatus', async (_event, repoRootFs: unknown) => {
    if (typeof repoRootFs !== 'string' || repoRootFs.length === 0) {
      return { kind: 'missing-path' }
    }
    const dir = await safeExistingDir(repoRootFs)
    if (!dir) return { kind: 'missing-path' }
    try {
      return await diffGetRepoStatus(dir)
    } catch (err) {
      return {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('diff:fileContent', async (_event, req: unknown) => {
    if (!isPlainObject(req)) {
      throw new Error('diff:fileContent: invalid request')
    }
    const root = await safeRepoRoot(req.repoRootFs)
    const safeScopeVal = safeScope(req.scope)
    if (!root || !safeScopeVal) {
      throw new Error('diff:fileContent: invalid scope or repo')
    }
    const fileReq = req as unknown as FileDiffRequest
    const reqFile = fileReq.file
    if (!reqFile || typeof reqFile !== 'object') {
      throw new Error('diff:fileContent: missing file')
    }
    const safeGitPath = sanitizeGitPath(reqFile.gitPath)
    if (!safeGitPath) {
      throw new Error('diff:fileContent: invalid gitPath')
    }
    let safeOldGitPath: string | undefined
    if (reqFile.oldGitPath !== undefined && reqFile.oldGitPath !== null) {
      const o = sanitizeGitPath(reqFile.oldGitPath)
      if (!o) throw new Error('diff:fileContent: invalid oldGitPath')
      safeOldGitPath = o
    }
    const safeFile = { ...reqFile, gitPath: safeGitPath, oldGitPath: safeOldGitPath }
    return diffFileContent({
      ...fileReq,
      file: safeFile,
      repoRootFs: root,
      scope: safeScopeVal
    })
  })

  ipcMain.handle('diff:listBranches', async (_event, repoRootFs: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root) {
      return { local: [], remote: [], defaultBase: null, resolvedDefaultRef: null }
    }
    const [local, remote, defaultBase] = await Promise.all([
      listLocalBranches(root),
      listRemoteBranches(root),
      resolveDefaultBaseBranch(root)
    ])
    const resolvedDefaultRef = defaultBase ? await resolveBranchBase(root, defaultBase) : null
    return { local, remote, defaultBase, resolvedDefaultRef }
  })

  ipcMain.handle('diff:stageFile', async (_event, repoRootFs: unknown, gitPath: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root || typeof gitPath !== 'string') {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    return stageFile(root, gitPath)
  })

  ipcMain.handle('diff:unstageFile', async (_event, repoRootFs: unknown, gitPath: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root || typeof gitPath !== 'string') {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    return unstageFile(root, gitPath)
  })

  ipcMain.handle('diff:discardFile', async (_event, repoRootFs: unknown, gitPath: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root || typeof gitPath !== 'string') {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    return discardFile(root, gitPath)
  })

  ipcMain.handle('diff:revertFile', async (_event, repoRootFs: unknown, gitPath: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root || typeof gitPath !== 'string') {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    return revertFile(root, gitPath)
  })

  ipcMain.handle('diff:deleteUntracked', async (_event, repoRootFs: unknown, gitPath: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root || typeof gitPath !== 'string') {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    return deleteUntracked(root, gitPath)
  })

  ipcMain.handle('diff:applyHunk', async (_event, req: unknown) => {
    if (!isPlainObject(req)) {
      return { ok: false, code: 'INVALID_INPUT' as const }
    }
    const root = await safeRepoRoot(req.repoRootFs)
    if (!root) return { ok: false, code: 'INVALID_INPUT' as const }
    const hunkReq = req as unknown as HunkMutationRequest
    return applyHunkPatch({ ...hunkReq, repoRootFs: root })
  })

  ipcMain.handle(
    'diff:saveWorkingFile',
    async (
      _event,
      repoRootFs: unknown,
      gitPath: unknown,
      content: unknown,
      eol: unknown,
      expectedMtimeMs: unknown
    ) => {
      const root = await safeRepoRoot(repoRootFs)
      if (
        !root ||
        typeof gitPath !== 'string' ||
        typeof content !== 'string' ||
        (eol !== '\n' && eol !== '\r\n')
      ) {
        return { ok: false, code: 'INVALID_INPUT' as const }
      }
      // Path discipline — reuse the same sanitizer the SCM ops use.
      const safeGitPath = sanitizeGitPath(gitPath)
      if (!safeGitPath) {
        return { ok: false, code: 'INVALID_INPUT' as const }
      }
      const fsPath = path.join(root, ...safeGitPath.split('/'))
      // Realpath the parent directory (the file itself may not yet exist
      // when writing a brand-new file, but the parent must) and verify it
      // stays inside the repo realpath. This catches in-repo symlinks that
      // point outside the worktree — `path.relative` alone follows symlinks
      // implicitly via the eventual `writeFile`, allowing escapes.
      let realParent: string
      try {
        realParent = await fs.promises.realpath(path.dirname(fsPath))
      } catch {
        return { ok: false, code: 'INVALID_INPUT' as const }
      }
      const relParent = path.relative(root, realParent)
      if (relParent.startsWith('..') || path.isAbsolute(relParent)) {
        return { ok: false, code: 'INVALID_INPUT' as const }
      }
      // If the file already exists, also confirm IT realpaths inside root
      // (catches symlink files that point outside the repo).
      try {
        const realFile = await fs.promises.realpath(fsPath)
        const relFile = path.relative(root, realFile)
        if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
          return { ok: false, code: 'INVALID_INPUT' as const }
        }
      } catch {
        /* file may not exist — that's fine, parent check covers creation */
      }
      try {
        if (typeof expectedMtimeMs === 'number') {
          const stat = await fs.promises.stat(fsPath).catch(() => null)
          if (!stat || Math.abs(stat.mtimeMs - expectedMtimeMs) > 1500) {
            return { ok: false, code: 'STALE_DIFF' as const }
          }
        }
        // Normalize EOL on the way out — caller passes the post-edit content
        // with whatever EOL the editor used; we re-emit using the requested style.
        const normalized = content.replace(/\r\n/g, '\n')
        const out = eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
        await fs.promises.writeFile(fsPath, out, 'utf8')
        const after = await fs.promises.stat(fsPath)
        return { ok: true, mtimeMs: after.mtimeMs }
      } catch (err) {
        return {
          ok: false,
          code: 'IO_ERROR' as const,
          message: err instanceof Error ? err.message : 'write failed'
        }
      }
    }
  )

  ipcMain.handle('diff:subscribe', async (event, repoRootFs: unknown) => {
    const root = await safeRepoRoot(repoRootFs)
    if (!root) return null
    const sender = event.sender
    const wcId = sender.id
    let set = diffSubsByWebContents.get(wcId)
    if (!set) {
      set = new Set()
      diffSubsByWebContents.set(wcId, set)
      // NOTE: We do NOT decrement watcher refcounts here. `subscribeChanges`
      // already installs its own `destroyed` listener that calls
      // `unsubscribeAll` (which removes the wc from the subscribers set
      // and tears the watcher down only when no live subscriber remains).
      // Decrementing per-token here would over-decrement and tear down
      // watchers other windows still depend on.
      sender.once('destroyed', () => {
        const tokens = diffSubsByWebContents.get(wcId)
        diffSubsByWebContents.delete(wcId)
        if (tokens) {
          for (const t of tokens) {
            diffTokensById.delete(String(t.id))
          }
        }
      })
    }
    const token = subscribeDiffChanges(root, sender)
    set.add(token)
    diffTokensById.set(String(token.id), token)
    return { token: String(token.id), repoRootFs: root }
  })

  ipcMain.on('diff:unsubscribe', (event, tokenId: unknown) => {
    if (typeof tokenId !== 'string') return
    const token = diffTokensById.get(tokenId)
    if (!token) return
    diffTokensById.delete(tokenId)
    const set = diffSubsByWebContents.get(event.sender.id)
    set?.delete(token)
    unsubscribeDiffChanges(token, event.sender.id)
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
  // Auto-update is a no-op in dev / unpackaged builds.
  initAutoUpdater(() => mainWindow)

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
