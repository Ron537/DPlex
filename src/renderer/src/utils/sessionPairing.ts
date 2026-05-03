import type { AISession, EditorTab, TerminalTab } from '../types'
import { isTerminalTab } from '../types'
import { normalizePath } from './normalizePath'
import { visualForStatus, type StatusVisual } from './sessionStatusVisual'

/** Open AI terminal tab augmented with the group it belongs to. */
export type OpenTabWithGroup = TerminalTab & { groupId: string }

/** A (tab, optional matched session) pair plus the leftover unpaired sessions. */
export interface PairedSessions {
  pairs: Array<{ tab: OpenTabWithGroup; match: AISession | undefined }>
  unpaired: AISession[]
  /** Total visible rows = pairs.length + unpaired.length. Use this for badge counts. */
  visibleCount: number
}

/**
 * Pair each open tab to an AI session. First by composite (providerId +
 * sessionId), then fall back to cwd + provider equality when the resolver
 * hasn't caught up yet. Sessions matched to tabs are claimed so they
 * don't render twice in the unpaired list.
 *
 * Extracted so both `ProjectSessionList` (renderer) and `WorktreeSection`
 * (header count) share one source of truth — preventing the count from
 * over-stating what's actually rendered.
 */
export function pairTabsToSessions(
  sessions: readonly AISession[],
  openTabs: readonly OpenTabWithGroup[]
): PairedSessions {
  const claimed = new Set<string>()
  const sessionKey = (s: AISession): string => `${s.aiTool}:${s.id}`
  const pairs = openTabs.map((tab) => {
    let match = tab.sessionId
      ? sessions.find(
          (s) =>
            s.id === tab.sessionId &&
            (!tab.providerId || s.aiTool === tab.providerId) &&
            !claimed.has(sessionKey(s))
        )
      : undefined
    if (!match) {
      // Cwd fallback — only kicks in for tabs that were started AS an AI
      // session (`providerId` set OR `command` includes a provider name).
      // A plain terminal opened with `+` has neither, and must never claim
      // an AI session that just happens to share its cwd: the result was
      // a "phantom" AI row hiding the actual terminal, with the terminal
      // disappearing from the list until the user opened more terminals
      // than AI sessions in the same scope.
      const tabIsAICandidate =
        Boolean(tab.providerId) || Boolean(tab.command && tab.command.trim().length > 0)
      if (tabIsAICandidate) {
        match = sessions.find((s) => {
          if (claimed.has(sessionKey(s))) return false
          if (s.status !== 'active') return false
          if (!s.cwd || !tab.cwd) return false
          if (normalizePath(s.cwd) !== normalizePath(tab.cwd)) return false
          if (tab.providerId && s.aiTool !== tab.providerId) return false
          const cmd = tab.command?.toLowerCase() ?? ''
          // When there's no providerId hint, fall back to a substring match
          // on the command string. We already know the command is non-empty
          // here (tabIsAICandidate guard above), so an empty `cmd` means
          // only providerId distinguishes; require it to match.
          if (!tab.providerId) return cmd.includes(s.aiTool.toLowerCase())
          return cmd.length === 0 || cmd.includes(s.aiTool.toLowerCase())
        })
      }
    }
    if (match) claimed.add(sessionKey(match))
    return { tab, match }
  })
  const unpaired = sessions.filter((s) => s.status === 'active' && !claimed.has(sessionKey(s)))
  return { pairs, unpaired, visibleCount: pairs.length + unpaired.length }
}

/**
 * Effective status for a session, applying the same fallback the row
 * renderer uses: active sessions without `detailedStatus` are treated as
 * `thinking`. Keeps `aggregateVisual` and `SessionItem` in sync so the
 * worktree header pill matches what the rows beneath it show.
 */
export function effectiveSessionVisual(session: AISession): StatusVisual {
  if (session.detailedStatus) return visualForStatus(session.detailedStatus)
  return session.status === 'active' ? 'thinking' : 'idle'
}

/** Type guard re-export for convenience when filtering raw editor tabs. */
export { isTerminalTab }
export type { EditorTab }
