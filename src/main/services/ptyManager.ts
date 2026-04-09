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

function shellDisplayName(shellPath: string): string {
  const base = shellPath.split('/').pop() || shellPath
  // Remove .exe suffix on Windows
  const name = base.replace(/\.exe$/i, '')
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export interface ShellInfo {
  name: string
  path: string
}

export function discoverAvailableShells(): ShellInfo[] {
  const seen = new Set<string>()
  const shells: ShellInfo[] = []

  function addShell(shellPath: string, name?: string): void {
    const resolved = shellPath.trim()
    if (!resolved || seen.has(resolved)) return
    try {
      fs.accessSync(resolved, fs.constants.X_OK)
      seen.add(resolved)
      shells.push({ name: name || shellDisplayName(resolved), path: resolved })
    } catch {
      // Not accessible / doesn't exist
    }
  }

  if (process.platform === 'win32') {
    // Windows: check known shell locations
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const localAppData = process.env.LOCALAPPDATA || ''

    const candidates: [string, string][] = [
      ['PowerShell', `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`],
      ['PowerShell 7', `${programFiles}\\PowerShell\\7\\pwsh.exe`],
      ['Command Prompt', `${systemRoot}\\System32\\cmd.exe`],
      ['Git Bash', `${programFiles}\\Git\\bin\\bash.exe`],
      ['WSL', `${systemRoot}\\System32\\wsl.exe`]
    ]

    // Also check user-local pwsh
    if (localAppData) {
      candidates.push(['PowerShell 7', `${localAppData}\\Microsoft\\WindowsApps\\pwsh.exe`])
    }

    for (const [name, path] of candidates) {
      addShell(path, name)
    }
  } else {
    // macOS / Linux: read /etc/shells
    try {
      const etcShells = fs.readFileSync('/etc/shells', 'utf-8')
      for (const line of etcShells.split('\n')) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          addShell(trimmed)
        }
      }
    } catch {
      // Fallback: try common paths
    }

    // Always check common shells as fallback (some may not be in /etc/shells)
    const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/fish', '/usr/local/bin/fish',
      '/opt/homebrew/bin/fish', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh',
      '/usr/local/bin/bash', '/opt/homebrew/bin/bash', '/bin/tcsh', '/bin/csh',
      '/usr/bin/tmux', '/usr/local/bin/tmux', '/opt/homebrew/bin/tmux',
      '/usr/local/bin/nu', '/opt/homebrew/bin/nu']
    for (const p of fallbacks) {
      addShell(p)
    }
  }

  // Sort: put the user's default shell first
  const defaultShell = getDefaultShell()
  shells.sort((a, b) => {
    if (a.path === defaultShell) return -1
    if (b.path === defaultShell) return 1
    return a.name.localeCompare(b.name)
  })

  return shells
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
