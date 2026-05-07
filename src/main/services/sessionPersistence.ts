import * as fs from 'fs'
import { app } from 'electron'
import * as path from 'path'

const SESSIONS_FILENAME = 'sessions.json'

function sessionsPath(): string {
  return path.join(app.getPath('userData'), SESSIONS_FILENAME)
}

export interface PersistedTab {
  id: string
  title: string
  shell?: string
  cwd?: string
  command?: string
  sessionId?: string
  providerId?: string
  worktreePath?: string
  worktreeBranch?: string
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
    const p = sessionsPath()
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8')
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
    const p = sessionsPath()
    const tmpPath = p + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
    fs.renameSync(tmpPath, p)
  } catch {
    // Ignore write errors
  }
}
