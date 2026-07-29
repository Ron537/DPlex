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
  /** Outstanding sub-agent tool-call ids → their start event timestamp (ms). */
  outstandingSubagents: Array<[string, number]>
  /** True once the main turn ended while sub-agents were still running. */
  mainTurnEnded: boolean
}

const cacheStore = new Map<string, ParserCache>()

/**
 * Max age for an outstanding sub-agent before the gate self-heals and drops it.
 * Background sub-agents occasionally never emit a `subagent.completed`/`failed`
 * (their completion is reported out-of-band), which would otherwise gate every
 * future turn-end and permanently wedge the session into "thinking" — the user
 * would never get another "finished" notification. Failing open (eventually
 * reporting idle) is far cheaper than failing closed forever. Genuinely-running
 * sub-agents drain the set on completion well before this bound.
 */
const SUBAGENT_MAX_AGE_MS = 10 * 60 * 1000

/** Event types found in Copilot CLI events.jsonl */
interface CopilotEvent {
  type: string
  /** Present on sub-agent-originated events; absent for the main agent. */
  agentId?: string
  data?: {
    content?: string
    [key: string]: unknown
  }
  timestamp?: string
}

/** Mutable per-parse context threaded through {@link processEvent}. */
interface ParseContext {
  pendingToolCalls: number
  /** Sub-agent key → start event timestamp (ms), for age-based self-healing. */
  outstandingSubagents: Map<string, number>
  mainTurnEnded: boolean
}

/** Stable key for a sub-agent lifecycle event (start ↔ completed/failed). */
function subagentKey(event: CopilotEvent): string | null {
  const toolCallId = event.data?.toolCallId
  if (typeof toolCallId === 'string' && toolCallId) return toolCallId
  if (typeof event.agentId === 'string' && event.agentId) return event.agentId
  return null
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
  const ctx: ParseContext = {
    pendingToolCalls: cached?.pendingToolCalls ?? 0,
    outstandingSubagents: new Map(cached?.outstandingSubagents ?? []),
    mainTurnEnded: cached?.mainTurnEnded ?? false
  }

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
        const eventTs = event.timestamp ? new Date(event.timestamp).getTime() : 0

        // Self-heal the sub-agent gate: drop any outstanding sub-agent whose
        // start is older than the bound, so an orphaned subagent.started (one
        // that never gets a completion event) can't wedge the session forever.
        if (eventTs > 0 && ctx.outstandingSubagents.size > 0) {
          for (const [key, startedAt] of ctx.outstandingSubagents) {
            if (eventTs - startedAt > SUBAGENT_MAX_AGE_MS) ctx.outstandingSubagents.delete(key)
          }
        }

        // Track sub-agent lifecycle before deriving status so the terminal-event
        // gate below sees the current outstanding count.
        if (event.type === 'subagent.started') {
          const key = subagentKey(event)
          if (key) ctx.outstandingSubagents.set(key, eventTs || Date.now())
        } else if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
          const key = subagentKey(event)
          if (key) ctx.outstandingSubagents.delete(key)
        }

        processEvent(event, data, ctx)

        if (event.type === 'tool.execution_start') ctx.pendingToolCalls++
        if (event.type === 'tool.execution_complete')
          ctx.pendingToolCalls = Math.max(0, ctx.pendingToolCalls - 1)

        // When the last background sub-agent finishes after the main turn had
        // already ended, the session is now genuinely idle → "finished".
        if (
          (event.type === 'subagent.completed' || event.type === 'subagent.failed') &&
          ctx.outstandingSubagents.size === 0 &&
          ctx.mainTurnEnded
        ) {
          data.detailedStatus = 'idle'
          data.terminalReason = 'completed'
          ctx.mainTurnEnded = false
        }

        // Any non-idle status clears the terminal reason (fresh work started).
        if (data.detailedStatus !== 'idle') data.terminalReason = undefined

        if (eventTs > data.lastActivityTime) data.lastActivityTime = eventTs
      } catch {
        // Skip malformed lines
      }
    }

    cacheStore.set(filePath, {
      byteOffset: startOffset + parsedByteCount,
      data,
      pendingToolCalls: ctx.pendingToolCalls,
      outstandingSubagents: [...ctx.outstandingSubagents],
      mainTurnEnded: ctx.mainTurnEnded
    })
  } finally {
    await fd.close()
  }

  return data
}

function processEvent(event: CopilotEvent, data: ParsedSessionData, ctx: ParseContext): void {
  switch (event.type) {
    case 'session.start':
    case 'session.resume':
      data.detailedStatus = 'idle'
      data.terminalReason = 'completed'
      ctx.mainTurnEnded = false
      // A fresh/resumed session must not stay gated by orphaned sub-agents
      // left over from an earlier run in the same file.
      ctx.outstandingSubagents.clear()
      break

    case 'user.message':
      data.detailedStatus = 'thinking'
      data.messageCount++
      ctx.mainTurnEnded = false
      break

    case 'assistant.turn_start':
      data.detailedStatus = 'thinking'
      ctx.mainTurnEnded = false
      break

    case 'tool.user_requested':
    case 'permission.requested':
      // Copilot is waiting on the user to approve a tool call.
      data.detailedStatus = 'awaitingApproval'
      break

    case 'permission.completed':
      // User responded to a permission prompt — only revert to thinking
      // if no other tools are still running (mirrors tool.execution_complete guard).
      if (ctx.pendingToolCalls <= 0) {
        data.detailedStatus = 'thinking'
      }
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
      if (ctx.pendingToolCalls <= 1) {
        data.detailedStatus = 'thinking'
      }
      break

    case 'assistant.turn_end':
      // The model's turn ended. Sub-agent gate: while background sub-agents are
      // still running, keep the session "working" so we don't fire a false
      // "finished" mid-Squad-run. A later subagent.completed (or the age-based
      // eviction) re-derives idle. task_complete/shutdown below are
      // authoritative and are NOT gated, so a session whose final event is one
      // of those can never wedge on an orphaned sub-agent.
      if (ctx.outstandingSubagents.size > 0) {
        ctx.mainTurnEnded = true
        data.detailedStatus = 'thinking'
      } else {
        data.detailedStatus = 'idle'
        // Preserve a prior abort/error reason from earlier in this batch — a
        // trailing turn_end must not downgrade an aborted/errored turn back to
        // a "completed" (false "finished") one.
        if (data.terminalReason !== 'aborted' && data.terminalReason !== 'error') {
          data.terminalReason = 'completed'
        }
      }
      break

    case 'session.task_complete':
    case 'session.shutdown':
      // Authoritative end of the task/session: the whole task (including any
      // background sub-agents) is done. These are typically the final events,
      // so they must NOT be gated on outstanding sub-agents — otherwise an
      // orphaned subagent.started would wedge the session in "thinking" forever
      // with no later event to release or age-evict the gate.
      data.detailedStatus = 'idle'
      if (data.terminalReason !== 'aborted' && data.terminalReason !== 'error') {
        data.terminalReason = 'completed'
      }
      ctx.outstandingSubagents.clear()
      ctx.mainTurnEnded = false
      break

    case 'abort':
      // User aborted the current turn (e.g., denied approval or Ctrl-C). This
      // is a cancel, not a completion — the attention layer suppresses the
      // "finished" notification for aborted turns.
      data.detailedStatus = 'idle'
      data.terminalReason = 'aborted'
      ctx.outstandingSubagents.clear()
      ctx.mainTurnEnded = false
      ctx.pendingToolCalls = 0
      break

    case 'session.error':
      // The turn failed (auth/quota/rate-limit/connection). Surface a distinct
      // "errored" attention instead of a misleading "finished".
      data.detailedStatus = 'idle'
      data.terminalReason = 'error'
      ctx.outstandingSubagents.clear()
      ctx.mainTurnEnded = false
      ctx.pendingToolCalls = 0
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
