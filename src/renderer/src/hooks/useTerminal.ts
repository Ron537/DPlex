import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import {
  getOrCreateTerminal,
  updateTerminalFont,
  applyThemeToAll,
  type TerminalEntry
} from '../services/terminalRegistry'

const SESSION_RESOLVE_RETRY_MS = 5000
const SESSION_RESOLVE_MAX_RETRIES = 6

function tabExists(terminalId: string): boolean {
  return useTerminalStore.getState().groups.some((g) => g.tabs.some((t) => t.id === terminalId))
}

async function resolveSessionIdForTab(terminalId: string, pid: number, cwd: string | undefined, attempt = 0): Promise<void> {
  if (!tabExists(terminalId)) return
  try {
    const result = await window.dplex.sessions.resolveSessionId(pid, cwd)
    if (result) {
      if (tabExists(terminalId)) {
        const store = useTerminalStore.getState()
        store.associateSessionId(terminalId, result.sessionId)
        store.renameTerminal(terminalId, result.displayName)
      }
      return
    }
  } catch {
    // ignore
  }
  // Retry if not resolved yet (AI tool may still be initializing)
  if (attempt < SESSION_RESOLVE_MAX_RETRIES) {
    setTimeout(() => resolveSessionIdForTab(terminalId, pid, cwd, attempt + 1), SESSION_RESOLVE_RETRY_MS)
  }
}

interface UseTerminalOptions {
  terminalId: string
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function useTerminal({ terminalId, containerRef }: UseTerminalOptions): {
  ready: boolean
} {
  const [ready, setReady] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const entryRef = useRef<TerminalEntry | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const entry = getOrCreateTerminal(terminalId, settings.fontSize, settings.fontFamily, settings.theme)
    entryRef.current = entry

    // Attach the persistent xterm DOM element to this container
    container.appendChild(entry.wrapperEl)

    // Fit after attaching (needs dimensions from container)
    requestAnimationFrame(() => {
      try {
        entry.fitAddon.fit()
      } catch {
        // ignore
      }
    })

    // If already connected to a PTY, we're ready
    if (entry.ready) {
      setReady(true)
    }

    // Only set up PTY if not already connected or in progress
    if (!entry.ptyId && !entry.cleanupIpc && !entry.creating) {
      entry.creating = true
      setReady(false)

      // Subscribe to IPC data FIRST
      const earlyBuffer: { id: string; data: string }[] = []
      let ptyIdResolved: string | null = null

      const removeDataListener = window.dplex.pty.onData((id, data) => {
        if (ptyIdResolved) {
          if (id === ptyIdResolved) {
            entry.term.write(data)
            if (!entry.ready) {
              entry.ready = true
              setReady(true)
            }
          }
        } else {
          earlyBuffer.push({ id, data })
        }
      })

      const removeExitListener = window.dplex.pty.onExit((id, _exitCode) => {
        if (id === ptyIdResolved) {
          entry.term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
        }
      })

      // Create PTY — use tab-specific shell, then settings default, then system default
      const termState = useTerminalStore.getState()
      const tab = termState.groups
        .flatMap((g) => g.tabs)
        .find((t) => t.id === terminalId)
      const tabShell = tab?.shell
      const tabCwd = tab?.cwd
      const tabCommand = tab?.command
      const defaultShell = useSettingsStore.getState().settings.defaultShell
      const shellToUse = tabShell || defaultShell || undefined
      window.dplex.pty.create(shellToUse, tabCwd, tabCommand).then(({ id: ptyId, pid }) => {
        entry.ptyId = ptyId
        ptyIdResolved = ptyId

        // Store PID on the tab for session ID resolution
        if (tabCommand && pid) {
          useTerminalStore.getState().setPid(terminalId, pid)
        }

        // Flush buffered output
        let hadData = false
        for (const item of earlyBuffer) {
          if (item.id === ptyId) {
            entry.term.write(item.data)
            hadData = true
          }
        }
        earlyBuffer.length = 0
        if (hadData) {
          entry.ready = true
          setReady(true)
        }

        // Connect terminal input → PTY
        const onDataDisposable = entry.term.onData((data) => {
          window.dplex.pty.write(ptyId, data)
        })

        const onResizeDisposable = entry.term.onResize(({ cols, rows }) => {
          window.dplex.pty.resize(ptyId, cols, rows)
        })

        // Sync current terminal size to PTY (it was created with default 80x24)
        const { cols, rows } = entry.term
        if (cols && rows) {
          window.dplex.pty.resize(ptyId, cols, rows)
        }

        // For AI sessions, resolve the session ID after a delay
        if (tabCommand && pid) {
          setTimeout(() => {
            resolveSessionIdForTab(terminalId, pid, tabCwd)
          }, 3000)
        }

        entry.cleanupIpc = () => {
          onDataDisposable.dispose()
          onResizeDisposable.dispose()
          removeDataListener()
          removeExitListener()
        }
      })
    }

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(() => {
      try {
        entry.fitAddon.fit()
      } catch {
        // ignore
      }
    })
    resizeObserver.observe(container)

    return () => {
      // Only detach the DOM element — do NOT destroy the terminal or PTY
      resizeObserver.disconnect()
      if (container.contains(entry.wrapperEl)) {
        container.removeChild(entry.wrapperEl)
      }
    }
  }, [terminalId])

  // Update font settings
  useEffect(() => {
    updateTerminalFont(terminalId, settings.fontSize, settings.fontFamily)
  }, [terminalId, settings.fontSize, settings.fontFamily])

  // Apply theme changes to this terminal
  useEffect(() => {
    applyThemeToAll(settings.theme)
  }, [settings.theme])

  return { ready }
}
