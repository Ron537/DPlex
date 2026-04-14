import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

export function useSessions(): void {
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const startWatching = useSessionStore((s) => s.startWatching)
  const stopWatching = useSessionStore((s) => s.stopWatching)

  useEffect(() => {
    refreshSessions().then(() => {
      startWatching()
    })
    return () => {
      stopWatching()
    }
  }, [])
}
