import * as fs from 'fs'
import { execFile } from 'child_process'

// Resolving another process's cwd should never block terminal creation, so the
// macOS `lsof` probe is bounded by a short timeout. Linux reads a symlink and
// returns effectively instantly.
const LSOF_TIMEOUT_MS = 400

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Parse the working-directory path out of `lsof -Fn` field output.
 *
 * In field-output mode lsof emits one field per line, each prefixed by a single
 * character (`p<pid>`, `f<fd>`, `n<name>`, …). We requested only the `cwd`
 * descriptor, so the first `n` line is the cwd path. Returns null when no name
 * field is present.
 */
export function parseLsofCwd(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    if (line.startsWith('n')) {
      const path = line.slice(1).trim()
      return path || null
    }
  }
  return null
}

function readLinuxCwd(pid: number): Promise<string | null> {
  return fs.promises
    .readlink(`/proc/${pid}/cwd`)
    .then((cwd) => (isDirectory(cwd) ? cwd : null))
    .catch(() => null)
}

function readMacCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)],
      { timeout: LSOF_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        const path = parseLsofCwd(stdout)
        resolve(path && isDirectory(path) ? path : null)
      }
    )
  })
}

/**
 * Resolve the current working directory of a live process by PID.
 *
 * - Linux: `readlink /proc/<pid>/cwd`
 * - macOS: `lsof` cwd descriptor (no native addon required)
 * - Windows: unsupported — there is no `/proc` and no simple unprivileged API,
 *   so this returns null and callers fall back to other cwd sources.
 *
 * Never throws; returns null on any failure or unsupported platform.
 */
export function getProcessCwd(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null)
  if (process.platform === 'linux') return readLinuxCwd(pid)
  if (process.platform === 'darwin') return readMacCwd(pid)
  return Promise.resolve(null)
}
