import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTerminalStore } from '../stores/terminalStore'
import {
  getOrCreateTerminal,
  updateTerminalFont,
  updateTerminalMacOptionIsMeta,
  applyThemeToAll,
  fireExitHandler,
  registerPtyDataHandler,
  type TerminalEntry
} from '../services/terminalRegistry'

const SESSION_RESOLVE_RETRY_MS = 5000
const SESSION_RESOLVE_MAX_RETRIES = 6

/**
 * OSC titles received before the tab's sessionId has been resolved.
 * Indexed by terminalId so we can replay the latest title into the live-title
 * override (and back into the tab) once {@link resolveSessionIdForTab}
 * associates the session. Without this, the title that the AI tool sets in
 * the first second or two — typically the most useful summary — was clobbered
 * by the provider's truncated-id displayName when association completed.
 */
const pendingOscTitles = new Map<string, string>()

function tabExists(terminalId: string): boolean {
  return useTerminalStore.getState().groups.some((g) => g.tabs.some((t) => t.id === terminalId))
}

async function resolveSessionIdForTab(
  terminalId: string,
  pid: number,
  cwd: string | undefined,
  providerId: string | undefined,
  attempt = 0
): Promise<void> {
  if (!tabExists(terminalId)) {
    pendingOscTitles.delete(terminalId)
    return
  }
  // Already resolved — never overwrite. The persisted sessionId is
  // authoritative on restore, and overwriting it during slow PID lookups
  // would let CWD fallback misassign a session from a different running
  // instance (or, before the providerId hint, from a different provider).
  const currentTab = useTerminalStore
    .getState()
    .groups.flatMap((g) => g.tabs)
    .find((t) => t.id === terminalId)
  if (currentTab && currentTab.kind !== 'fileDiff' && currentTab.sessionId) {
    pendingOscTitles.delete(terminalId)
    return
  }
  try {
    const result = await window.dplex.sessions.resolveSessionId(pid, cwd, providerId)
    if (result) {
      if (tabExists(terminalId)) {
        const store = useTerminalStore.getState()
        store.associateSessionId(terminalId, result.sessionId)
        // If an OSC title arrived before resolution, prefer it — that's
        // typically the AI tool's own summary of what the session is about
        // and is more useful than the provider's truncated-id fallback.
        const pending = pendingOscTitles.get(terminalId)
        const titleToUse = pending ?? result.displayName
        store.renameTerminal(terminalId, titleToUse)
        if (pending && providerId) {
          useSessionStore.getState().setLiveTabTitle(providerId, result.sessionId, pending)
        }
        pendingOscTitles.delete(terminalId)
      }
      return
    }
  } catch {
    // ignore
  }
  // Retry if not resolved yet (AI tool may still be initializing)
  if (attempt < SESSION_RESOLVE_MAX_RETRIES) {
    setTimeout(
      () => resolveSessionIdForTab(terminalId, pid, cwd, providerId, attempt + 1),
      SESSION_RESOLVE_RETRY_MS
    )
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

    const entry = getOrCreateTerminal(
      terminalId,
      settings.fontSize,
      settings.fontFamily,
      settings.macOptionIsMeta,
      settings.theme
    )
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

      // Buffer data that arrives before PTY ID is known (race between
      // IPC listener registration and pty:create response)
      const earlyBuffer: { id: string; data: string }[] = []
      let earlyCleanup: (() => void) | null = null

      earlyCleanup = window.dplex.pty.onData((id, data) => {
        earlyBuffer.push({ id, data })
      })

      const removeExitListener = window.dplex.pty.onExit((id, exitCode) => {
        // Early exit before PTY ID resolved — unlikely but handle gracefully
        earlyBuffer.push({ id, data: '' })
        void exitCode
      })

      // Create PTY — use tab-specific shell, then settings default, then system default
      const termState = useTerminalStore.getState()
      const tab = termState.groups.flatMap((g) => g.tabs).find((t) => t.id === terminalId)
      // fileDiff tabs never spawn a PTY — they are rendered by FileDiffTabView
      // and have no shell/command. The hook short-circuits earlier in the call
      // site, but we still narrow defensively here to keep the union honest.
      const terminalTab = tab && tab.kind !== 'fileDiff' ? tab : undefined
      const tabShell = terminalTab?.shell
      const tabCwd = terminalTab?.cwd
      const tabCommand = terminalTab?.command
      const tabProviderId = terminalTab?.providerId
      const defaultShell = useSettingsStore.getState().settings.defaultShell
      const shellToUse = tabShell || defaultShell || undefined
      window.dplex.pty
        .create(shellToUse, tabCwd, tabCommand)
        .then(({ id: ptyId, pid }) => {
          // Guard: if tab was removed from store before PTY resolved, clean up
          if (!tabExists(terminalId)) {
            window.dplex.pty.destroy(ptyId)
            if (earlyCleanup) earlyCleanup()
            removeExitListener()
            entry.creating = false
            return
          }

          entry.ptyId = ptyId

          // Remove the early listeners — the centralized dispatcher takes over
          if (earlyCleanup) {
            earlyCleanup()
            earlyCleanup = null
          }
          removeExitListener()

          // Register with centralized dispatcher for O(1) routing + flow control
          const unregisterHandler = registerPtyDataHandler(
            ptyId,
            terminalId,
            entry,
            (exitCode) => {
              entry.term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
              fireExitHandler(terminalId, exitCode)
            },
            () => {
              setReady(true)
            }
          )

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

          // Sync terminal title changes (OSC escape sequences) to the tab
          // title, and mirror to the matching AI session row in the sidebar
          // via a live override. The override survives subsequent provider
          // re-parses, which is necessary because Copilot CLI emits its OSC
          // title before plan.md / events.jsonl land on disk — without the
          // override the sidebar briefly shows the right name and then snaps
          // back to the truncated session id when the provider's update
          // arrives. The override is cleared when the tab is closed via
          // useTerminalStore.removeTerminal. If the title arrives before
          // session id resolution completes we stash it in pendingOscTitles
          // so resolveSessionIdForTab can apply it once the sessionId is
          // known.
          const onTitleDisposable = entry.term.onTitleChange((title) => {
            if (!title || !tabExists(terminalId)) return
            const store = useTerminalStore.getState()
            store.renameTerminal(terminalId, title)
            const t = store.groups.flatMap((g) => g.tabs).find((tab) => tab.id === terminalId)
            if (!t || t.kind === 'fileDiff' || !t.providerId) return
            if (t.sessionId) {
              useSessionStore.getState().setLiveTabTitle(t.providerId, t.sessionId, title)
              pendingOscTitles.delete(terminalId)
            } else {
              pendingOscTitles.set(terminalId, title)
            }
          })

          // Sync current terminal size to PTY (it was created with default 80x24)
          const { cols, rows } = entry.term
          if (cols && rows) {
            window.dplex.pty.resize(ptyId, cols, rows)
          }

          // For AI sessions, resolve the session ID after a delay
          if (tabCommand && pid) {
            setTimeout(() => {
              resolveSessionIdForTab(terminalId, pid, tabCwd, tabProviderId)
            }, 3000)
          }

          entry.creating = false
          entry.cleanupIpc = () => {
            unregisterHandler()
            onDataDisposable.dispose()
            onResizeDisposable.dispose()
            onTitleDisposable.dispose()
          }
        })
        .catch(() => {
          if (earlyCleanup) earlyCleanup()
          removeExitListener()
          entry.creating = false
          entry.term.write('\r\n\x1b[31m[Failed to start terminal]\x1b[0m\r\n')
          entry.ready = true
          setReady(true)
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

  // Apply the Option-as-Meta preference live to this terminal
  useEffect(() => {
    updateTerminalMacOptionIsMeta(terminalId, settings.macOptionIsMeta)
  }, [terminalId, settings.macOptionIsMeta])

  // Apply theme changes to this terminal
  useEffect(() => {
    applyThemeToAll(settings.theme)
  }, [settings.theme])

  return { ready }
}
