import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type {
  SessionProvider,
  DiscoveredSession,
  ActiveProjectSession,
  ResolvedSession
} from './types'

export class CopilotProvider implements SessionProvider {
  readonly id = 'copilot-cli'
  readonly name = 'Copilot CLI'
  readonly command = 'copilot'

  private get sessionDir(): string {
    return path.join(os.homedir(), '.copilot', 'session-state')
  }

  // ── Discovery ────────────────────────────────────────────────────

  async discoverSessions(): Promise<DiscoveredSession[]> {
    const sessionDir = this.sessionDir
    if (!(await this.dirExists(sessionDir))) return []

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      const sessions: DiscoveredSession[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)

        try {
          const stat = await fsp.stat(fullPath)
          const displayName = this.getDisplayName(fullPath, entry.name)
          const workspace = await this.parseWorkspaceYamlAsync(fullPath)

          sessions.push({
            id: entry.name,
            displayName,
            status: (await this.isSessionActive(fullPath)) ? 'active' : 'idle',
            aiTool: this.id,
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

  async getActiveProjectSessions(projectPaths: string[]): Promise<ActiveProjectSession[]> {
    const sessionDir = this.sessionDir
    const results: ActiveProjectSession[] = []
    if (!(await this.dirExists(sessionDir))) return results

    const normalizedPaths = projectPaths.map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)

        try {
          const files = await fsp.readdir(fullPath)
          const lockFile = files.find((f) => f.startsWith('inuse.') && f.endsWith('.lock'))
          if (!lockFile) continue

          const pid = parseInt(lockFile.replace('inuse.', '').replace('.lock', ''), 10)
          if (isNaN(pid)) continue
          try {
            process.kill(pid, 0)
          } catch {
            continue
          }

          const workspace = await this.parseWorkspaceYamlAsync(fullPath)
          if (!workspace.cwd) continue

          const normalizedCwd = workspace.cwd.replace(/\\/g, '/').replace(/\/+$/, '')
          const matches = normalizedPaths.some(
            (pp) => normalizedCwd === pp || normalizedCwd.startsWith(pp + '/')
          )
          if (!matches) continue

          const displayName = this.getDisplayName(fullPath, entry.name)
          results.push({ id: entry.name, displayName, cwd: workspace.cwd, aiTool: this.id })
        } catch {
          // skip
        }
      }
    } catch {
      // ignore
    }

    return results
  }

  // ── Session Lifecycle ────────────────────────────────────────────

  async closeSession(sessionId: string): Promise<boolean> {
    const fullPath = this.resolveAndValidateSessionPath(sessionId)
    if (!fullPath) return false

    try {
      const files = await fsp.readdir(fullPath)
      const lockFiles = files.filter((f) => /^inuse\.\d+\.lock$/.test(f))
      if (lockFiles.length === 0) return false

      let killed = false
      for (const lockFile of lockFiles) {
        const match = lockFile.match(/^inuse\.(\d+)\.lock$/)
        if (!match) continue
        const pid = parseInt(match[1], 10)
        if (isNaN(pid) || pid <= 0) continue
        try {
          process.kill(pid, 'SIGTERM')
          killed = true
        } catch {
          // Process already gone
        }
      }
      return killed
    } catch {
      return false
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const fullPath = this.resolveAndValidateSessionPath(sessionId)
    if (!fullPath) throw new Error('Invalid session ID')
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true })
    }
  }

  // ── Session Resolution ───────────────────────────────────────────

  async resolveSessionByPid(pid: number): Promise<ResolvedSession | null> {
    const sessionDir = this.sessionDir
    const lockFileName = `inuse.${pid}.lock`

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
            const displayName = this.getDisplayName(fullPath, entry.name)
            return { sessionId: entry.name, displayName }
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

  async resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null> {
    const sessionDir = this.sessionDir
    const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!(await this.dirExists(sessionDir))) return null

    let bestMatch: { id: string; mtime: number; fullPath: string } | null = null

    try {
      const entries = await fsp.readdir(sessionDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = path.join(sessionDir, entry.name)

        try {
          const files = await fsp.readdir(fullPath)
          const lockFile = files.find((f) => f.startsWith('inuse.') && f.endsWith('.lock'))
          if (!lockFile) continue

          const lockPid = parseInt(lockFile.replace('inuse.', '').replace('.lock', ''), 10)
          if (isNaN(lockPid)) continue
          try {
            process.kill(lockPid, 0)
          } catch {
            continue
          }

          const yamlPath = path.join(fullPath, 'workspace.yaml')
          let yamlContent: string
          try {
            yamlContent = await fsp.readFile(yamlPath, 'utf-8')
          } catch {
            continue
          }
          const cwdMatch = yamlContent.match(/^cwd:\s*(.+)$/m)
          if (!cwdMatch) continue
          const sessionCwd = cwdMatch[1].trim().replace(/\\/g, '/').replace(/\/+$/, '')
          if (sessionCwd !== normalizedCwd) continue

          const stat = await fsp.stat(fullPath)
          if (!bestMatch || stat.mtimeMs > bestMatch.mtime) {
            bestMatch = { id: entry.name, mtime: stat.mtimeMs, fullPath }
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // ignore
    }

    if (!bestMatch) return null
    const displayName = this.getDisplayName(bestMatch.fullPath, bestMatch.id)
    return { sessionId: bestMatch.id, displayName }
  }

  // ── Command Building ─────────────────────────────────────────────

  getResumeCommand(sessionId: string): string {
    return `copilot --resume=${sessionId}`
  }

  getNewSessionCommand(): string {
    return 'copilot'
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      await fsp.access(dirPath)
      return true
    } catch {
      return false
    }
  }

  private validateSessionId(sessionId: string): boolean {
    if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      return false
    }
    return true
  }

  private resolveAndValidateSessionPath(sessionId: string): string | null {
    if (!this.validateSessionId(sessionId)) return null
    const targetPath = path.join(this.sessionDir, sessionId)
    const resolved = path.resolve(targetPath)
    if (!resolved.startsWith(path.resolve(this.sessionDir) + path.sep)) return null
    return resolved
  }

  private async isSessionActive(sessionDir: string): Promise<boolean> {
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

  private getDisplayName(sessionDir: string, sessionId: string): string {
    const planPath = path.join(sessionDir, 'plan.md')
    const planName = fs.existsSync(planPath) ? this.parsePlanSummary(planPath) : undefined
    if (planName) return planName

    const workspace = this.parseWorkspaceYaml(sessionDir)
    if (workspace.summary) return workspace.summary

    const firstMsg = this.parseFirstUserMessage(sessionDir)
    if (firstMsg) return firstMsg

    return sessionId.slice(0, 12)
  }

  private parsePlanSummary(planPath: string): string | undefined {
    try {
      const content = fs.readFileSync(planPath, 'utf-8')
      const firstHeading = content.match(/^#\s+(.+)$/m)
      return firstHeading?.[1]?.trim()
    } catch {
      return undefined
    }
  }

  private parseWorkspaceYaml(sessionDir: string): { summary?: string; cwd?: string } {
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

  private async parseWorkspaceYamlAsync(sessionDir: string): Promise<{ summary?: string; cwd?: string }> {
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

  private parseFirstUserMessage(sessionDir: string): string | undefined {
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
}
