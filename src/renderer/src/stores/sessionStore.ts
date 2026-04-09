import { create } from 'zustand'
import type { AISession } from '../types'

interface SessionState {
  sessions: AISession[]
  loading: boolean
  error: string | null
  searchQuery: string

  refreshSessions: () => Promise<void>
  setSearchQuery: (query: string) => void
  deleteSession: (sessionId: string) => Promise<void>

  getActiveSessions: () => AISession[]
  getIdleSessions: () => AISession[]
  getFilteredSessions: () => { active: AISession[]; idle: AISession[] }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,
  searchQuery: '',

  refreshSessions: async () => {
    set({ loading: true, error: null })
    try {
      const sessions = await window.dplex.sessions.discover()
      set({ sessions, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  deleteSession: async (sessionId) => {
    try {
      await window.dplex.sessions.delete(sessionId)
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== sessionId)
      }))
    } catch (err) {
      set({ error: String(err) })
    }
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
            (s.summary && s.summary.toLowerCase().includes(q))
        )
      : sessions
    return {
      active: filtered.filter((s) => s.status === 'active'),
      idle: filtered.filter((s) => s.status === 'idle')
    }
  }
}))
