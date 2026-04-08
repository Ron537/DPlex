import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'

export function useSessions(): void {
  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const pollInterval = useSettingsStore((s) => s.settings.sessionPollIntervalMs)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    refreshSessions()

    intervalRef.current = setInterval(refreshSessions, pollInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [refreshSessions, pollInterval])
}
