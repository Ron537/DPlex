import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'

const SESSIONS_PATH = path.join(app.getPath('userData'), 'sessions.json')

export interface PersistedTab {
  id: string
  title: string
  shell?: string
  cwd?: string
  command?: string
  sessionId?: string
}

export interface PersistedGroup {
  id: string
  tabs: PersistedTab[]
  activeTabId: string
}

export interface PersistedWorkspace {
  layout: unknown
  groups: PersistedGroup[]
  activeGroupId: string | null
  savedAt: string
}

export function loadWorkspace(): PersistedWorkspace | null {
  try {
    if (fs.existsSync(SESSIONS_PATH)) {
      const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8')
      const parsed = JSON.parse(raw) as PersistedWorkspace
      if (parsed && Array.isArray(parsed.groups) && parsed.layout) {
        return parsed
      }
    }
  } catch {
    // Corrupted file — fall back to fresh start
  }
  return null
}

export function saveWorkspace(data: PersistedWorkspace): void {
  try {
    // Atomic write: temp file → rename to avoid corruption on crash
    const tmpPath = SESSIONS_PATH + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
    fs.renameSync(tmpPath, SESSIONS_PATH)
  } catch {
    // Ignore write errors
  }
}

/**
 * Find the copilot session ID associated with a given PID.
 * Scans copilot session dirs for lock files matching the PID.
 * Returns the session directory name (= session ID) or null.
 */
export async function resolveSessionIdByPid(pid: number): Promise<string | null> {
  const sessionDir = path.join(os.homedir(), '.copilot', 'session-state')
  const lockFileName = `inuse.${pid}.lock`

  // Verify the PID is actually alive before searching
  try {
    process.kill(pid, 0)
  } catch {
    return null
  }

  try {
    const entries = await fsp.readdir(sessionDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(sessionDir, entry.name)

      try {
        const files = await fsp.readdir(fullPath)
        if (files.includes(lockFileName)) {
          return entry.name
        }
      } catch {
        // Skip unreadable dirs
      }
    }
  } catch {
    // Session directory doesn't exist
  }

  return null
}
