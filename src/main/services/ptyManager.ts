import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import * as os from 'os'
import * as fs from 'fs'

interface PtyEntry {
  process: pty.IPty
  windowId: number
}

const ptys = new Map<string, PtyEntry>()
let idCounter = 0

function getDefaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

function generatePtyId(): string {
  return `pty-${++idCounter}-${Date.now()}`
}

function validateCwd(cwd: string): boolean {
  try {
    const stat = fs.statSync(cwd)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export function createPty(
  window: BrowserWindow,
  shell?: string,
  cwd?: string
): string {
  const id = generatePtyId()
  const shellPath = shell || getDefaultShell()
  const safeCwd = cwd && validateCwd(cwd) ? cwd : os.homedir()
  const shellArgs = process.platform === 'win32' ? [] : ['--login']

  const ptyProcess = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: safeCwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      SHELL_SESSIONS_DISABLE: '1'
    } as Record<string, string>
  })

  ptyProcess.onData((data) => {
    if (!window.isDestroyed()) {
      window.webContents.send('pty:data', { id, data })
    }
  })

  ptyProcess.onExit(({ exitCode }) => {
    ptys.delete(id)
    if (!window.isDestroyed()) {
      window.webContents.send('pty:exit', { id, exitCode })
    }
  })

  ptys.set(id, { process: ptyProcess, windowId: window.id })

  return id
}

export function writePty(id: string, data: string): void {
  ptys.get(id)?.process.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  try {
    ptys.get(id)?.process.resize(cols, rows)
  } catch {
    // Ignore resize errors for already-exited processes
  }
}

export function destroyPty(id: string): void {
  const entry = ptys.get(id)
  if (entry) {
    try {
      entry.process.kill()
    } catch {
      // Already exited
    }
    ptys.delete(id)
  }
}

export function destroyAllPtys(): void {
  for (const [id] of ptys) {
    destroyPty(id)
  }
}

export function destroyPtysForWindow(windowId: number): void {
  for (const [id, entry] of ptys) {
    if (entry.windowId === windowId) {
      destroyPty(id)
    }
  }
}

export function getDefaultShellPath(): string {
  return getDefaultShell()
}
