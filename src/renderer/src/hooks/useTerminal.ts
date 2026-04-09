import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'
import {
  getOrCreateTerminal,
  getTerminalEntry,
  updateTerminalFont,
  type TerminalEntry
} from '../services/terminalRegistry'

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

    const entry = getOrCreateTerminal(terminalId, settings.fontSize, settings.fontFamily)
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

    // Only set up PTY if not already connected
    if (!entry.ptyId && !entry.cleanupIpc) {
      setReady(false)

      // Subscribe to IPC data FIRST
      const earlyBuffer: { id: string; data: string }[] = []
      let ptyIdResolved: string | null = null

      const removeDataListener = window.tplex.pty.onData((id, data) => {
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

      const removeExitListener = window.tplex.pty.onExit((id, _exitCode) => {
        if (id === ptyIdResolved) {
          entry.term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
        }
      })

      // Create PTY
      window.tplex.pty.create().then((ptyId) => {
        entry.ptyId = ptyId
        ptyIdResolved = ptyId

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
          window.tplex.pty.write(ptyId, data)
        })

        const onResizeDisposable = entry.term.onResize(({ cols, rows }) => {
          window.tplex.pty.resize(ptyId, cols, rows)
        })

        // Check for pending command
        const pendingCmd = useTerminalStore.getState().popPendingCommand(terminalId)
        if (pendingCmd) {
          setTimeout(() => {
            window.tplex.pty.write(ptyId, pendingCmd + '\n')
          }, 500)
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

  return { ready }
}
