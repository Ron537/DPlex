import * as fs from 'fs'
import { app } from 'electron'
import * as path from 'path'

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
