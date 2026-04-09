import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

export function useSessions(): void {
  const refreshSessions = useSessionStore((s) => s.refreshSessions)

  useEffect(() => {
    refreshSessions()
  }, [])
}
