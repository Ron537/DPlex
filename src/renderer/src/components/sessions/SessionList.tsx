import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { SessionItem } from './SessionItem'
import { PromptsDialog } from './PromptsDialog'
import { Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import type { AISession } from '../../types'
import { isTerminalTab } from '../../types'
import type { SessionGroupMode } from '../layout/SidePanel'
import { filterSessions } from '../../utils/sessionFilters'

/**
 * Active-section sort priority. Lower number = higher in the list.
 *   0 — pending approval / waiting for user (the user is on the hook)
 *   1 — thinking / executing a tool (the agent is on the hook)
 *   2 — active but neither (idle agent). These are further sorted by
 *       "has an open tab first, then by recency" inside `compareActive`
 *       below.
 */
function activeSortBucket(s: AISession): number {
  const ds = s.detailedStatus
  if (ds === 'awaitingApproval' || ds === 'waitingForUser') return 0
  if (ds === 'thinking' || ds === 'executingTool') return 1
  return 2
}

interface SessionListProps {
  groupMode: SessionGroupMode
  providerFilter: string
  statusFilters: Set<string>
  /**
   * Collapse-all toolbar signal. Each press of the toolbar button bumps
   * `nonce` and flips `collapsed`. Each <CollapsibleGroup> reacts to a
   * new nonce by adopting the new collapsed value, while still letting
   * users toggle individual groups in between presses.
   */
  collapseAllSignal?: { nonce: number; collapsed: boolean }
}

interface SessionGroup {
  label: string
  sessions: AISession[]
}

function getTimeGroupLabel(date: Date): string {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const startOfLastWeek = new Date(startOfToday.getTime() - 7 * 86400000)
  const startOfLastMonth = new Date(startOfToday.getTime() - 30 * 86400000)

  const ts = date.getTime()
  if (ts >= startOfToday.getTime()) return 'Today'
  if (ts >= startOfYesterday.getTime()) return 'Yesterday'
  if (ts >= startOfLastWeek.getTime()) return 'Last 7 Days'
  if (ts >= startOfLastMonth.getTime()) return 'Last 30 Days'
  return 'Older'
}

function groupByTime(sessions: AISession[]): SessionGroup[] {
  const order = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older']
  const map = new Map<string, AISession[]>()

  for (const session of sessions) {
    const label = getTimeGroupLabel(new Date(session.updatedAt))
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(session)
  }

  return order
    .filter((label) => map.has(label))
    .map((label) => ({ label, sessions: map.get(label)! }))
}

function folderName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

function groupByWorkspace(sessions: AISession[]): SessionGroup[] {
  const map = new Map<string, AISession[]>()

  for (const session of sessions) {
    const label = session.cwd ? folderName(session.cwd) : 'Unknown'
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(session)
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, sessions]) => ({ label, sessions }))
}

export function SessionList({
  groupMode,
  providerFilter,
  statusFilters,
  collapseAllSignal
}: SessionListProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const loading = useSessionStore((s) => s.loading)
  const error = useSessionStore((s) => s.error)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const hideEmptySessions = useSettingsStore((s) => s.settings.hideEmptySessions)
  const groups = useTerminalStore((s) => s.groups)

  // Set of `${providerId}:${sessionId}` for sessions currently represented
  // by an open terminal tab. Used as the secondary sort key for active-but-
  // not-running sessions (open ones float above unopened ones).
  const openSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const g of groups) {
      for (const t of g.tabs) {
        if (!isTerminalTab(t)) continue
        if (t.sessionId && t.providerId) set.add(`${t.providerId}:${t.sessionId}`)
      }
    }
    return set
  }, [groups])


  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { active, groups: idleGroups, flatList } = useMemo(() => {
    const filtered = filterSessions(sessions, {
      searchQuery,
      providerFilter,
      statusFilters,
      hideEmptySessions
    })

    const idle = filtered.filter((s) => s.status === 'idle')
    const activeList = filtered.filter((s) => s.status === 'active')

    const sessionTime = (s: AISession): number =>
      s.lastActivityTime ?? new Date(s.updatedAt).getTime()
    const compareActive = (a: AISession, b: AISession): number => {
      const ba = activeSortBucket(a)
      const bb = activeSortBucket(b)
      if (ba !== bb) return ba - bb
      // Bucket 2 only: prioritize sessions with an open tab.
      if (ba === 2) {
        const aOpen = openSessionIds.has(`${a.aiTool}:${a.id}`) ? 1 : 0
        const bOpen = openSessionIds.has(`${b.aiTool}:${b.id}`) ? 1 : 0
        if (aOpen !== bOpen) return bOpen - aOpen
      }
      // Final tiebreaker: most recent activity first.
      return sessionTime(b) - sessionTime(a)
    }
    activeList.sort(compareActive)

    const groupedIdle = groupMode === 'time' ? groupByTime(idle) : groupByWorkspace(idle)

    // Build flat list for keyboard nav
    const flat: AISession[] = [...activeList, ...groupedIdle.flatMap((g) => g.sessions)]

    return {
      active: activeList,
      groups: groupedIdle,
      flatList: flat
    }
  }, [
    sessions,
    searchQuery,
    groupMode,
    providerFilter,
    statusFilters,
    hideEmptySessions,
    openSessionIds
  ])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (flatList.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Escape') {
        setSelectedIndex(-1)
      }
    },
    [flatList.length]
  )

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIndex(-1)
  }, [searchQuery, providerFilter, statusFilters])

  if (loading && active.length === 0 && idleGroups.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return <div className="px-3 py-4 text-xs text-red-400">Failed to load sessions</div>
  }

  if (active.length === 0 && idleGroups.length === 0) {
    return (
      <div className="px-3 py-8 text-xs text-zinc-500 text-center">
        No sessions found.
        <br />
        <span className="text-zinc-600">Sessions from your AI tool will appear here.</span>
      </div>
    )
  }

  return (
    <>
      <div
        ref={listRef}
        className="flex flex-col gap-1"
        tabIndex={0}
        data-selected-index={selectedIndex}
      >
        {active.length > 0 && (
          <CollapsibleGroup
            label={`Active (${active.length})`}
            accent
            collapseAllSignal={collapseAllSignal}
          >
            {active.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onDelete={deleteSession}
                onShowPrompts={setPromptsSession}
              />
            ))}
          </CollapsibleGroup>
        )}

        {idleGroups.map((group) => (
          <CollapsibleGroup
            key={group.label}
            label={group.label}
            collapseAllSignal={collapseAllSignal}
          >
            {group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                onDelete={deleteSession}
                onShowPrompts={setPromptsSession}
              />
            ))}
          </CollapsibleGroup>
        ))}
      </div>

      {promptsSession && (
        <PromptsDialog
          sessionId={promptsSession.id}
          sessionName={promptsSession.displayName}
          providerId={promptsSession.aiTool}
          onClose={() => setPromptsSession(null)}
        />
      )}
    </>
  )
}

function CollapsibleGroup({
  label,
  accent,
  collapseAllSignal,
  children
}: {
  label: string
  accent?: boolean
  collapseAllSignal?: { nonce: number; collapsed: boolean }
  children: React.ReactNode
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  // Track the last collapse-all nonce we've applied so we only react to
  // *new* presses of the toolbar button, not to every parent re-render.
  // Individual user toggles between presses are preserved.
  const lastAppliedNonceRef = useRef(0)
  useEffect(() => {
    if (!collapseAllSignal) return
    if (collapseAllSignal.nonce === 0) return
    if (lastAppliedNonceRef.current === collapseAllSignal.nonce) return
    lastAppliedNonceRef.current = collapseAllSignal.nonce
    setCollapsed(collapseAllSignal.collapsed)
  }, [collapseAllSignal])

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full px-2 py-1 mt-1 text-[10px] font-medium uppercase tracking-wider hover:bg-[var(--dplex-hover)] transition-colors"
        style={{
          color: accent ? 'var(--dplex-accent)' : 'var(--dplex-text-muted)'
        }}
      >
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        {label}
      </button>
      {!collapsed && children}
    </div>
  )
}
