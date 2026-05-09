import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { DiscoveredSession, ParsedSessionData, SessionPrompt } from './types'
import { BaseSessionProvider, type SessionEntry } from './baseProvider'
import {
  parseCopilotEvents,
  extractCopilotPrompts,
  clearCopilotParseCache
} from './copilotEventsParser'

export class CopilotProvider extends BaseSessionProvider {
  readonly id = 'copilot-cli'
  readonly name = 'Copilot CLI'
  readonly command = 'copilot'
  readonly icon = 'copilot'

  // ── Abstract method implementations ──────────────────────────────

  protected getSessionDir(): string {
    return path.join(os.homedir(), '.copilot', 'session-state')
  }

  protected async parseSession(entry: SessionEntry): Promise<DiscoveredSession | null> {
    const { id: dirName, path: dirPath } = entry
    try {
      const workspace = await this.parseWorkspaceYaml(dirPath)
      const displayName = await this.getDisplayName(dirPath, dirName)
      const isActive = (await this.getActivePidForEntry(entry)) !== null

      // Parse events for enriched data
      const eventsPath = path.join(dirPath, 'events.jsonl')
      let parsed: ParsedSessionData | null = null
      let eventsMtimeMs = entry.mtimeMs
      try {
        const eventsStat = await fsp.stat(eventsPath)
        eventsMtimeMs = eventsStat.mtimeMs
        parsed = await this.parseEventsIncremental(eventsPath)
      } catch {
        // events.jsonl may not exist yet
      }

      // Use events.jsonl mtime for updatedAt (more accurate than dir mtime)
      const updatedAt = new Date(eventsMtimeMs).toISOString()

      return {
        id: dirName,
        displayName,
        status: isActive ? 'active' : 'idle',
        aiTool: this.id,
        createdAt: new Date(entry.birthtimeMs).toISOString(),
        updatedAt,
        cwd: workspace.cwd,
        summary: displayName,
        branch: workspace.branch,
        detailedStatus: parsed?.detailedStatus ?? 'idle',
        messageCount: parsed?.messageCount ?? 0,
        toolCallCount: parsed?.toolCallCount ?? 0,
        lastActivityTime: parsed?.lastActivityTime ?? eventsMtimeMs
      }
    } catch {
      return null
    }
  }

  protected parseEventsIncremental(filePath: string): Promise<ParsedSessionData> {
    return parseCopilotEvents(filePath)
  }

  protected extractPromptsFromEvents(sessionDir: string, limit: number): Promise<SessionPrompt[]> {
    return extractCopilotPrompts(sessionDir, limit)
  }

  getResumeCommand(sessionId: string): string {
    return `copilot --resume=${sessionId}`
  }

  getNewSessionCommand(): string {
    return 'copilot'
  }

  protected onSessionDeleted(entry: SessionEntry): void {
    clearCopilotParseCache(path.join(entry.path, 'events.jsonl'))
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private async getDisplayName(sessionDir: string, sessionId: string): Promise<string> {
    // Newer Copilot CLI versions write the human-readable session title to
    // `workspace.yaml` as `name:`. Older versions used `summary:` and/or a
    // `plan.md` heading. Check the modern field first, fall back through the
    // legacy sources, and finally to the first user prompt and a truncated id.
    const workspace = await this.parseWorkspaceYaml(sessionDir)
    if (workspace.name) return workspace.name

    const planPath = path.join(sessionDir, 'plan.md')
    const planName = await this.parsePlanSummary(planPath)
    if (planName) return planName

    if (workspace.summary) return workspace.summary

    const firstMsg = await this.parseFirstUserMessage(sessionDir)
    if (firstMsg) return firstMsg

    return sessionId.slice(0, 12)
  }

  private async parsePlanSummary(planPath: string): Promise<string | undefined> {
    try {
      const content = await fsp.readFile(planPath, 'utf-8')
      const firstHeading = content.match(/^#\s+(.+)$/m)
      return firstHeading?.[1]?.trim()
    } catch {
      return undefined
    }
  }

  private async parseWorkspaceYaml(
    sessionDir: string
  ): Promise<{ name?: string; summary?: string; cwd?: string; branch?: string }> {
    try {
      const yamlPath = path.join(sessionDir, 'workspace.yaml')
      const content = await fsp.readFile(yamlPath, 'utf-8')
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const summaryMatch = content.match(/^summary:\s*(.+)$/m)
      const cwdMatch = content.match(/^cwd:\s*(.+)$/m)
      const branchMatch = content.match(/^branch:\s*(.+)$/m)
      return {
        name: nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined,
        summary: summaryMatch?.[1]?.trim() || undefined,
        cwd: cwdMatch?.[1]?.trim() || undefined,
        branch: branchMatch?.[1]?.trim() || undefined
      }
    } catch {
      return {}
    }
  }

  private async parseFirstUserMessage(sessionDir: string): Promise<string | undefined> {
    try {
      const eventsPath = path.join(sessionDir, 'events.jsonl')
      const fd = await fsp.open(eventsPath, 'r')
      try {
        const buffer = Buffer.alloc(8192)
        const { bytesRead } = await fd.read(buffer, 0, 8192, 0)
        const content = buffer.toString('utf-8', 0, bytesRead)
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
      } finally {
        await fd.close()
      }
    } catch {
      // ignore
    }
    return undefined
  }
}
