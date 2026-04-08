import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useSettingsStore } from '../stores/settingsStore'
import { useTerminalStore } from '../stores/terminalStore'

interface UseTerminalOptions {
  terminalId: string
  containerRef: React.RefObject<HTMLDivElement | null>
}

const DARK_THEME = {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#1a1a2e',
  selectionBackground: '#3a3a5e',
  black: '#1a1a2e',
  red: '#ff6b6b',
  green: '#51cf66',
  yellow: '#ffd43b',
  blue: '#74c0fc',
  magenta: '#cc5de8',
  cyan: '#66d9e8',
  white: '#e0e0e0',
  brightBlack: '#555577',
  brightRed: '#ff8787',
  brightGreen: '#69db7c',
  brightYellow: '#ffe066',
  brightBlue: '#91d5ff',
  brightMagenta: '#da77f2',
  brightCyan: '#99e9f2',
  brightWhite: '#ffffff'
}

export function useTerminal({ terminalId, containerRef }: UseTerminalOptions): {
  terminal: Terminal | null
} {
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const ptyIdRef = useRef<string | null>(null)
  const settings = useSettingsStore((s) => s.settings)

  const handleResize = useCallback(() => {
    if (fitAddonRef.current) {
      try {
        fitAddonRef.current.fit()
      } catch {
        // Ignore fit errors during teardown
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      theme: DARK_THEME,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 10000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    term.open(container)

    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {
        // ignore
      }
    })

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Step 1: Subscribe to IPC data FIRST (before creating PTY) to prevent output loss
    const removeDataListener = window.tplex.pty.onData((id, data) => {
      if (id === ptyIdRef.current) {
        term.write(data)
      }
    })

    const removeExitListener = window.tplex.pty.onExit((id, _exitCode) => {
      if (id === ptyIdRef.current) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
      }
    })

    // Step 2: Create PTY in main process (invoke returns the server-generated ID)
    window.tplex.pty.create().then((ptyId) => {
      ptyIdRef.current = ptyId

      // Now connect terminal input → PTY
      const onDataDisposable = term.onData((data) => {
        window.tplex.pty.write(ptyId, data)
      })

      const onResizeDisposable = term.onResize(({ cols, rows }) => {
        window.tplex.pty.resize(ptyId, cols, rows)
      })

      // Check for pending command (e.g., resume session)
      const pendingCmd = useTerminalStore.getState().popPendingCommand(terminalId)
      if (pendingCmd) {
        setTimeout(() => {
          window.tplex.pty.write(ptyId, pendingCmd + '\n')
        }, 500)
      }

      // Store disposables for cleanup
      cleanupRef.current = () => {
        onDataDisposable.dispose()
        onResizeDisposable.dispose()
        removeDataListener()
        removeExitListener()
        window.tplex.pty.destroy(ptyId)
        term.dispose()
        termRef.current = null
        fitAddonRef.current = null
        ptyIdRef.current = null
      }
    })

    // ResizeObserver for container changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      if (cleanupRef.current) {
        cleanupRef.current()
      } else {
        // PTY create hasn't resolved yet — clean up what we can
        removeDataListener()
        removeExitListener()
        term.dispose()
        termRef.current = null
        fitAddonRef.current = null
      }
    }
  }, [terminalId]) // Only re-run if terminalId changes

  // Update font settings when they change
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = settings.fontSize
      termRef.current.options.fontFamily = settings.fontFamily
      handleResize()
    }
  }, [settings.fontSize, settings.fontFamily, handleResize])

  return { terminal: termRef.current }
}
