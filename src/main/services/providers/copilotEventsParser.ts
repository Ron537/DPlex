import * as fsp from 'fs/promises'
import * as path from 'path'
import type { ParsedSessionData, SessionPrompt } from './types'

/**
 * Incremental JSONL parser for Copilot CLI session events.
 * Uses byte-offset caching to avoid re-parsing entire files on each update.
 */

interface ParserCache {
  byteOffset: number
  data: ParsedSessionData
  pendingToolCalls: number
}

const cacheStore = new Map<string, ParserCache>()

/** Event types found in Copilot CLI events.jsonl */
interface CopilotEvent {
  type: string
  data?: {
    content?: string
    [key: string]: unknown
  }
  timestamp?: string
}

/**
 * Incrementally parse a Copilot events.jsonl file.
 * Only reads new bytes since last parse via byte-offset cache.
 */
export async function parseCopilotEvents(filePath: string): Promise<ParsedSessionData> {
  const cached = cacheStore.get(filePath)
  let data: ParsedSessionData = cached?.data ?? {
    detailedStatus: 'idle',
    messageCount: 0,
    toolCallCount: 0,
    lastActivityTime: 0
  }

  const startOffset = cached?.byteOffset ?? 0
  let pendingToolCalls = cached?.pendingToolCalls ?? 0

  let stat: { size: number }
  try {
    stat = await fsp.stat(filePath)
  } catch {
    return data
  }

  if (stat.size <= startOffset) {
    return data
  }

  // Read only new bytes
  const fd = await fsp.open(filePath, 'r')
  try {
    const newSize = stat.size - startOffset
    const buffer = Buffer.alloc(newSize)
    const { bytesRead } = await fd.read(buffer, 0, newSize, startOffset)
    const content = buffer.toString('utf-8', 0, bytesRead)

    // Clone data so we don't mutate cached copy mid-parse
    data = { ...data }

    // Only advance offset through the last complete newline.
    // If the content doesn't end with \n, the trailing fragment may be incomplete
    // and must be re-read on the next parse.
    const endsWithNewline = content.endsWith('\n')
    const lines = content.split('\n')
    const lastIncompleteLen = endsWithNewline
      ? 0
      : Buffer.byteLength(lines[lines.length - 1], 'utf-8')
    const parsedByteCount = bytesRead - lastIncompleteLen

    for (let i = 0; i < lines.length - (endsWithNewline ? 0 : 1); i++) {
      const trimmed = lines[i].trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as CopilotEvent
        processEvent(event, data, pendingToolCalls)

        if (event.type === 'tool.execution_start') pendingToolCalls++
        if (event.type === 'tool.execution_complete')
          pendingToolCalls = Math.max(0, pendingToolCalls - 1)

        if (event.timestamp) {
          const ts = new Date(event.timestamp).getTime()
          if (ts > data.lastActivityTime) data.lastActivityTime = ts
        }
      } catch {
        // Skip malformed lines
      }
    }

    cacheStore.set(filePath, {
      byteOffset: startOffset + parsedByteCount,
      data,
      pendingToolCalls
    })
  } finally {
    await fd.close()
  }

  return data
}

function processEvent(
  event: CopilotEvent,
  data: ParsedSessionData,
  pendingToolCalls: number
): void {
  switch (event.type) {
    case 'session.start':
    case 'session.resume':
      data.detailedStatus = 'idle'
      break

    case 'user.message':
      data.detailedStatus = 'thinking'
      data.messageCount++
      break

    case 'assistant.turn_start':
      data.detailedStatus = 'thinking'
      break

    case 'assistant.turn_end':
      data.detailedStatus = 'idle'
      break

    case 'tool.user_requested':
      // Copilot is waiting on the user to approve a tool call.
      data.detailedStatus = 'awaitingApproval'
      break

    case 'tool.execution_start': {
      // Copilot's built-in `ask_user` tool is not really a tool — it blocks
      // on the user answering a prompt, so treat it as waitingForUser.
      const toolName = (event.data?.toolName as string | undefined) ?? ''
      if (toolName === 'ask_user') {
        data.detailedStatus = 'waitingForUser'
      } else {
        data.detailedStatus = 'executingTool'
      }
      data.toolCallCount++
      break
    }

    case 'tool.execution_complete':
      // Only revert to thinking if this was the last outstanding tool call
      if (pendingToolCalls <= 1) {
        data.detailedStatus = 'thinking'
      }
      break

    case 'session.task_complete':
      // Authoritative "agent finished its task" signal.
      data.detailedStatus = 'idle'
      break

    case 'abort':
      // User aborted the current turn (e.g., denied approval or Ctrl-C).
      data.detailedStatus = 'idle'
      break

    case 'session.shutdown':
      data.detailedStatus = 'idle'
      break
  }
}

/**
 * Extract user prompts from a Copilot events.jsonl file.
 * Returns the last `limit` prompts, max 300 chars each.
 */
export async function extractCopilotPrompts(
  sessionDir: string,
  limit: number
): Promise<SessionPrompt[]> {
  const eventsPath = path.join(sessionDir, 'events.jsonl')
  const prompts: SessionPrompt[] = []

  try {
    const content = await fsp.readFile(eventsPath, 'utf-8')
    const lines = content.split('\n')
    let index = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as CopilotEvent
        if (event.type === 'user.message' && event.data?.content) {
          const text = event.data.content.trim()
          if (text) {
            prompts.push({
              text: text.length > 300 ? text.slice(0, 297) + '...' : text,
              timestamp: event.timestamp ? new Date(event.timestamp).getTime() : undefined,
              index: index++
            })
          }
        }
      } catch {
        continue
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }

  // Return last N prompts
  return prompts.slice(-limit)
}

/** Clear cached parse state for a file (useful when session is deleted). */
export function clearCopilotParseCache(filePath: string): void {
  cacheStore.delete(filePath)
}
