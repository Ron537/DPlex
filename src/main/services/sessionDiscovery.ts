import * as fs from 'fs'
import * as fsp from 'fs/promises'
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

function parseWorkspaceYaml(sessionDir: string): { summary?: string; cwd?: string } {
  try {
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    if (!fs.existsSync(yamlPath)) return {}
    const content = fs.readFileSync(yamlPath, 'utf-8')
    const summaryMatch = content.match(/^summary:\s*(.+)$/m)
    const cwdMatch = content.match(/^cwd:\s*(.+)$/m)
    return {
      summary: summaryMatch?.[1]?.trim() || undefined,
      cwd: cwdMatch?.[1]?.trim() || undefined
    }
  } catch {
    return {}
  }
}

async function parseWorkspaceYamlAsync(sessionDir: string): Promise<{ summary?: string; cwd?: string }> {
  try {
    const yamlPath = path.join(sessionDir, 'workspace.yaml')
    const content = await fsp.readFile(yamlPath, 'utf-8')
    const summaryMatch = content.match(/^summary:\s*(.+)$/m)
    const cwdMatch = content.match(/^cwd:\s*(.+)$/m)
    return {
      summary: summaryMatch?.[1]?.trim() || undefined,
      cwd: cwdMatch?.[1]?.trim() || undefined
    }
  } catch {
    return {}
  }
}

function parseFirstUserMessage(sessionDir: string): string | undefined {
  try {
    const eventsPath = path.join(sessionDir, 'events.jsonl')
    if (!fs.existsSync(eventsPath)) return undefined
    const content = fs.readFileSync(eventsPath, 'utf-8')
    const lines = content.split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === 'user.message' && event.data?.content) {
          const msg = event.data.content.trim()
          // Truncate long messages
          return msg.length > 80 ? msg.slice(0, 77) + '...' : msg
        }
      } catch {
        continue
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

export function getDisplayName(sessionDir: string, sessionId: string): string {
  // Priority: plan.md heading > workspace.yaml summary > first user message > folder name
  const planPath = path.join(sessionDir, 'plan.md')
  const planName = fs.existsSync(planPath) ? parsePlanSummary(planPath) : undefined
  if (planName) return planName

  const workspace = parseWorkspaceYaml(sessionDir)
  if (workspace.summary) return workspace.summary

  const firstMsg = parseFirstUserMessage(sessionDir)
  if (firstMsg) return firstMsg

  return sessionId.slice(0, 12)
}

async function isSessionActive(sessionDir: string): Promise<boolean> {
  try {
    const files = await fsp.readdir(sessionDir)
    const lockFile = files.find((f) => f.startsWith('inuse.') && f.endsWith('.lock'))
    if (!lockFile) return false

    const pidStr = lockFile.replace('inuse.', '').replace('.lock', '')
    const pid = parseInt(pidStr, 10)
    if (isNaN(pid)) return false

    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
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

export async function discoverCopilotSessions(): Promise<DiscoveredSession[]> {
  const sessionDir = getCopilotSessionDir()

  try {
    await fsp.access(sessionDir)
  } catch {
    return []
  }

  try {
    const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
    const sessions: DiscoveredSession[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const fullPath = path.join(sessionDir, entry.name)

      try {
        const stat = await fsp.stat(fullPath)
        const displayName = getDisplayName(fullPath, entry.name)
        const workspace = await parseWorkspaceYamlAsync(fullPath)

        sessions.push({
          id: entry.name,
          displayName,
          status: (await isSessionActive(fullPath)) ? 'active' : 'idle',
          aiTool: 'copilot-cli',
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          cwd: workspace.cwd,
          summary: displayName
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

/**
 * Returns active sessions matching any of the given project paths.
 * Optimized: first finds sessions with lock files (few), then reads
 * workspace.yaml only for those to check cwd match. Avoids reading
 * all 2000+ session yamls every poll.
 */
export interface ActiveProjectSession {
  id: string
  displayName: string
  cwd: string
}

export async function getActiveProjectSessions(projectPaths: string[]): Promise<ActiveProjectSession[]> {
  const sessionDir = getCopilotSessionDir()
  const results: ActiveProjectSession[] = []

  try {
    await fsp.access(sessionDir)
  } catch {
    return results
  }

  const normalizedPaths = projectPaths.map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))

  try {
    const entries = await fsp.readdir(sessionDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(sessionDir, entry.name)

      // Step 1: Quick check — does this session have a lock file?
      try {
        const files = await fsp.readdir(fullPath)
        const lockFile = files.find((f) => f.startsWith('inuse.') && f.endsWith('.lock'))
        if (!lockFile) continue

        // Verify PID is running
        const pid = parseInt(lockFile.replace('inuse.', '').replace('.lock', ''), 10)
        if (isNaN(pid)) continue
        try { process.kill(pid, 0) } catch { continue }

        // Step 2: Only now read workspace.yaml for this active session
        const workspace = await parseWorkspaceYamlAsync(fullPath)
        if (!workspace.cwd) continue

        const normalizedCwd = workspace.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
        const matches = normalizedPaths.some(
          (pp) => normalizedCwd === pp || normalizedCwd.startsWith(pp + '/')
        )
        if (!matches) continue

        const displayName = getDisplayName(fullPath, entry.name)
        results.push({ id: entry.name, displayName, cwd: workspace.cwd })
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }

  return results
}
