import { create } from 'zustand'
import type { AISession, SessionStatus } from '../types'

interface SessionState {
  sessions: AISession[]
  loading: boolean
  error: string | null
  searchQuery: string
  watching: boolean
  sessionNameOverrides: Record<string, string>

  refreshSessions: () => Promise<void>
  setSearchQuery: (query: string) => void
  closeSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  setSessionNameOverride: (sessionId: string, name: string) => void
  startWatching: () => void
  stopWatching: () => void

  getActiveSessions: () => AISession[]
  getIdleSessions: () => AISession[]
  getFilteredSessions: () => { active: AISession[]; idle: AISession[] }
}

/** Composite key for session identity — prevents cross-provider ID collisions. */
function sessionKey(aiTool: string, id: string): string {
  return `${aiTool}:${id}`
}

function mapDiscoveredToAISession(
  s: Awaited<ReturnType<typeof window.dplex.sessions.discover>>[number],
  nameOverrides: Record<string, string>
): AISession {
  const key = sessionKey(s.aiTool, s.id)
  return {
    id: s.id,
    displayName: nameOverrides[key] ?? nameOverrides[s.id] ?? s.displayName,
    status: s.status === 'active' ? ('active' as const) : ('idle' as const),
    aiTool: s.aiTool,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
    cwd: s.cwd,
    summary: s.summary,
    detailedStatus: (s.detailedStatus as SessionStatus) ?? undefined,
    branch: s.branch,
    messageCount: s.messageCount,
    toolCallCount: s.toolCallCount,
    lastActivityTime: s.lastActivityTime
  }
}

export const useSessionStore = create<SessionState>((set, get) => {
  // Track cleanup functions for IPC listeners
  let cleanupFns: (() => void)[] = []

  return {
    sessions: [],
    loading: false,
    error: null,
    searchQuery: '',
    watching: false,
    sessionNameOverrides: {},

    refreshSessions: async () => {
      set({ loading: true, error: null })
      try {
        // Load persisted name overrides from settings on first refresh
        if (Object.keys(get().sessionNameOverrides).length === 0) {
          const settings = await window.dplex.settings.getAll()
          const saved = (settings as Record<string, unknown>).sessionNameOverrides
          if (saved && typeof saved === 'object') {
            set({ sessionNameOverrides: saved as Record<string, string> })
          }
        }
        const raw = await window.dplex.sessions.discover()
        const { sessionNameOverrides } = get()
        const sessions = raw.map((s) => mapDiscoveredToAISession(s, sessionNameOverrides))
        set({ sessions, loading: false })
      } catch (err) {
        set({ error: String(err), loading: false })
      }
    },

    setSearchQuery: (query) => {
      set({ searchQuery: query })
    },

    closeSession: async (sessionId) => {
      const session = get().sessions.find((s) => s.id === sessionId)
      const providerId = session?.aiTool
      try {
        await window.dplex.sessions.close(sessionId, providerId)
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId && s.aiTool === providerId
              ? { ...s, status: 'idle' as const, detailedStatus: 'idle' as const }
              : s
          )
        }))
      } catch (err) {
        get().refreshSessions()
        set({ error: String(err) })
      }
    },

    deleteSession: async (sessionId) => {
      const session = get().sessions.find((s) => s.id === sessionId)
      const providerId = session?.aiTool
      try {
        await window.dplex.sessions.delete(sessionId, providerId)
        set((state) => ({
          sessions: state.sessions.filter((s) =>
            !(s.id === sessionId && s.aiTool === (providerId ?? s.aiTool))
          )
        }))
      } catch (err) {
        set({ error: String(err) })
      }
    },

    setSessionNameOverride: (sessionId, name) => {
      const session = get().sessions.find((s) => s.id === sessionId)
      const key = session ? sessionKey(session.aiTool, sessionId) : sessionId
      set((state) => {
        const overrides = { ...state.sessionNameOverrides, [key]: name }
        window.dplex.settings.merge({ sessionNameOverrides: overrides })
        return {
          sessionNameOverrides: overrides,
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, displayName: name } : s
          )
        }
      })
    },

    startWatching: () => {
      if (get().watching) return

      const unsubUpdated = window.dplex.sessions.onSessionUpdated((raw) => {
        const updated = mapDiscoveredToAISession(raw, get().sessionNameOverrides)
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === updated.id && s.aiTool === updated.aiTool ? updated : s
          )
        }))
      })

      const unsubAdded = window.dplex.sessions.onSessionAdded((raw) => {
        const added = mapDiscoveredToAISession(raw, get().sessionNameOverrides)
        set((state) => {
          if (state.sessions.some((s) => s.id === added.id && s.aiTool === added.aiTool)) {
            return state
          }
          return { sessions: [added, ...state.sessions] }
        })
      })

      const unsubRemoved = window.dplex.sessions.onSessionRemoved((sessionId, providerId) => {
        set((state) => ({
          sessions: state.sessions.filter((s) =>
            !(s.id === sessionId && s.aiTool === providerId)
          )
        }))
      })

      cleanupFns = [unsubUpdated, unsubAdded, unsubRemoved]
      window.dplex.sessions.startWatching()
      set({ watching: true })
    },

    stopWatching: () => {
      for (const cleanup of cleanupFns) cleanup()
      cleanupFns = []
      window.dplex.sessions.stopWatching()
      set({ watching: false })
    },

    getActiveSessions: () => get().sessions.filter((s) => s.status === 'active'),
    getIdleSessions: () => get().sessions.filter((s) => s.status === 'idle'),

    getFilteredSessions: () => {
      const { sessions, searchQuery } = get()
      const q = searchQuery.toLowerCase()
      const filtered = q
        ? sessions.filter(
            (s) =>
              s.displayName.toLowerCase().includes(q) ||
              s.id.toLowerCase().includes(q) ||
              (s.summary && s.summary.toLowerCase().includes(q)) ||
              (s.cwd && s.cwd.toLowerCase().includes(q)) ||
              (s.branch && s.branch.toLowerCase().includes(q))
          )
        : sessions
      return {
        active: filtered.filter((s) => s.status === 'active'),
        idle: filtered.filter((s) => s.status === 'idle')
      }
    }
  }
})
