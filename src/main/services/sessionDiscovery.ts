import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface DiscoveredSession {
  id: string
  displayName: string
  status: 'active' | 'idle'
  aiTool: string
  createdAt: string
  updatedAt: string
  cwd?: string
  summary?: string
}

function getCopilotSessionDir(): string {
  return path.join(os.homedir(), '.copilot', 'session-state')
}

function parsePlanSummary(planPath: string): string | undefined {
  try {
    const content = fs.readFileSync(planPath, 'utf-8')
    const firstHeading = content.match(/^#\s+(.+)$/m)
    return firstHeading?.[1]?.trim()
  } catch {
    return undefined
  }
}

function isSessionActive(sessionDir: string): boolean {
  try {
    const stat = fs.statSync(sessionDir)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
    return stat.mtimeMs > fiveMinutesAgo
  } catch {
    return false
  }
}

function validateSessionId(sessionId: string): boolean {
  // Reject path separators, '..' traversal, and empty strings
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
    return false
  }
  return true
}

function resolveAndValidateSessionPath(sessionId: string): string | null {
  if (!validateSessionId(sessionId)) return null
  const baseDir = getCopilotSessionDir()
  const targetPath = path.join(baseDir, sessionId)
  const resolved = path.resolve(targetPath)
  // Ensure resolved path is still within the base directory
  if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) return null
  return resolved
}

export function discoverCopilotSessions(): DiscoveredSession[] {
  const sessionDir = getCopilotSessionDir()

  if (!fs.existsSync(sessionDir)) return []

  try {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true })
    const sessions: DiscoveredSession[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const fullPath = path.join(sessionDir, entry.name)

      try {
        const stat = fs.statSync(fullPath)
        const planPath = path.join(fullPath, 'plan.md')
        const summary = fs.existsSync(planPath) ? parsePlanSummary(planPath) : undefined

        sessions.push({
          id: entry.name,
          displayName: summary || entry.name.slice(0, 12),
          status: isSessionActive(fullPath) ? 'active' : 'idle',
          aiTool: 'copilot-cli',
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          summary
        })
      } catch {
        // Skip unreadable sessions
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  } catch {
    return []
  }
}

export async function deleteSessionDir(sessionId: string): Promise<void> {
  const fullPath = resolveAndValidateSessionPath(sessionId)
  if (!fullPath) {
    throw new Error('Invalid session ID')
  }
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true })
  }
}
