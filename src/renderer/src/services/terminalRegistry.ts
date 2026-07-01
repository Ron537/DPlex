import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getTheme } from './themes'
import { FlowController } from './flowControl'
import { isMac } from '../utils/shortcuts'
import {
  wordMotionSequence,
  shiftEnterSequence,
  modifyOtherKeysActive
} from '../utils/terminalKeys'
import {
  clipboardKeyAction,
  copyTerminalSelection,
  parseOsc52,
  pasteIntoTerminal
} from './terminalClipboard'
import { useSettingsStore } from '../stores/settingsStore'
import { TruecolorSgrNormalizer } from './truecolorSgrNormalizer'

export interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  wrapperEl: HTMLDivElement
  truecolorNormalizer: TruecolorSgrNormalizer
  ready: boolean
  creating: boolean
  cleanupIpc: (() => void) | null
  /** Disposes the per-terminal clipboard wiring (key/selection/contextmenu). */
  disposeExtras: (() => void) | null
}

// Global registry — lives outside React lifecycle
const registry = new Map<string, TerminalEntry>()

// ── Centralized PTY Data Dispatcher ─────────────────────────────────────
// Single global IPC listener routes data to the correct terminal via O(1)
// Map lookup instead of O(N) broadcast across all terminal listeners.
// Flow control is handled by FlowController per terminal.

interface PtyDataHandler {
  terminalId: string
  entry: TerminalEntry
  flowController: FlowController
  onReady: (() => void) | null
}

const dataHandlers = new Map<string, PtyDataHandler>()
const exitHandlers = new Map<string, (exitCode: number) => void>()

let globalDataListenerCleanup: (() => void) | null = null

function ensureGlobalListeners(): void {
  if (globalDataListenerCleanup) return

  globalDataListenerCleanup = window.dplex.pty.onData((ptyId, data) => {
    const handler = dataHandlers.get(ptyId)
    if (!handler) return

    handler.flowController.write(handler.entry.truecolorNormalizer.write(data))

    if (!handler.entry.ready) {
      handler.entry.ready = true
      if (handler.onReady) {
        handler.onReady()
        handler.onReady = null
      }
    }
  })

  window.dplex.pty.onExit((ptyId, exitCode) => {
    const handler = exitHandlers.get(ptyId)
    if (handler) handler(exitCode)
  })
}

/** Register a terminal to receive PTY data via the centralized dispatcher. */
export function registerPtyDataHandler(
  ptyId: string,
  terminalId: string,
  entry: TerminalEntry,
  onExit: (exitCode: number) => void,
  onReady?: () => void
): () => void {
  ensureGlobalListeners()

  const transport = {
    pause: (id: string) => window.dplex.pty.pause(id),
    resume: (id: string) => window.dplex.pty.resume(id)
  }

  const flowController = new FlowController(ptyId, entry.term, transport)

  dataHandlers.set(ptyId, {
    terminalId,
    entry,
    flowController,
    onReady: onReady || null
  })

  exitHandlers.set(ptyId, onExit)

  return () => {
    flowController.dispose()
    dataHandlers.delete(ptyId)
    exitHandlers.delete(ptyId)
  }
}

export function getOrCreateTerminal(
  terminalId: string,
  fontSize: number,
  fontFamily: string,
  macOptionIsMeta: boolean,
  themeId?: string,
  isAiPane = false
): TerminalEntry {
  const existing = registry.get(terminalId)
  if (existing) return existing

  const appTheme = getTheme(themeId || 'dplex')

  const term = new Terminal({
    fontFamily,
    fontSize,
    theme: appTheme.terminal,
    cursorBlink: true,
    cursorStyle: 'block',
    allowProposedApi: true,
    macOptionIsMeta,
    // Don't let xterm reselect the word under the cursor on right-click
    // (its default on macOS). We drive right-click copy/paste ourselves, and
    // reselecting would replace the user's selection before our contextmenu
    // handler runs — so right-click only copied when clicked on the selection.
    rightClickSelectsWord: false,
    scrollback: 10000
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  // Track whether the foreground app has enabled xterm's modifyOtherKeys mode
  // (CSI > 4 ; n m). Copilot/Claude CLIs enable it; plain shells do not. We use
  // it to gate Shift+Enter translation so the encoded sequence only reaches
  // apps that understand it. xterm.js does not implement modifyOtherKeys, so we
  // observe the request and leave the rest of its handling untouched (the
  // handler returns false so xterm keeps processing the sequence normally).
  let modifyOtherKeys = false
  const modifyOtherKeysDisposable = term.parser.registerCsiHandler(
    { prefix: '>', final: 'm' },
    (params) => {
      const active = modifyOtherKeysActive(params)
      if (active !== null) modifyOtherKeys = active
      return false
    }
  )

  // OSC 52 clipboard writes. AI CLIs (Copilot/Claude) enable mouse tracking and
  // do their own drag-selection; when the user copies, they ask the terminal to
  // set the host clipboard via OSC 52 (`ESC ] 52 ; c ; <base64> BEL`). xterm has
  // no built-in OSC 52 handler, so without this the sequence is parsed and
  // silently dropped — the app prints "copied" but nothing reaches the system
  // clipboard (issue #86). We honor writes and ignore read requests (Pd = `?`)
  // so a program can't exfiltrate the clipboard.
  const osc52Disposable = term.parser.registerOscHandler(52, (data) => {
    const text = parseOsc52(data)
    if (text !== null) window.dplex.clipboard.writeText(text)
    return true
  })

  // Copy/paste + (macOS) word-motion + Shift+Enter key handling. xterm allows a
  // single custom key handler, so these concerns share one. Returning false
  // stops xterm from forwarding the key to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    const action = clipboardKeyAction(e, { isMac, hasSelection: term.hasSelection() })
    if (action === 'copy') {
      e.preventDefault()
      copyTerminalSelection(term)
      return false
    }
    if (action === 'paste') {
      e.preventDefault()
      void pasteIntoTerminal(term)
      return false
    }
    // Shift+Enter: when the foreground app enabled modifyOtherKeys (Copilot/
    // Claude CLIs), send the modifyOtherKeys encoding so the prompt inserts a
    // newline instead of submitting. xterm would otherwise send a bare CR.
    const shiftEnter = shiftEnterSequence(e, modifyOtherKeys)
    if (shiftEnter !== null) {
      e.preventDefault()
      term.input(shiftEnter)
      return false
    }
    // macOS-only: when ⌥ Option is left to compose characters
    // (macOptionIsMeta off), restore word-wise navigation by translating
    // ⌥+Arrow / ⌥+Backspace to readline escape sequences. The Option-as-Meta
    // conflict does not exist on Windows/Linux, where non-US layouts compose
    // symbols via AltGr.
    if (isMac && !term.options.macOptionIsMeta) {
      const seq = wordMotionSequence(e)
      if (seq !== null) {
        e.preventDefault()
        term.input(seq)
        return false
      }
    }
    return true
  })

  // Right-click. In AI panes the CLI (Copilot/Claude) enables mouse tracking and
  // owns the right-click itself — it copies the selection (via OSC 52, handled
  // above) and pastes from its own buffer. If DPlex also pasted here the text
  // would be inserted twice (#86), so we suppress the OS menu and let the
  // forwarded right-click reach the app. Plain shells have no mouse tracking, so
  // DPlex provides right-click copy/paste (Windows Terminal convention): copy the
  // selection (clearing it so a follow-up right-click pastes), else paste.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (isAiPane) return
    if (!copyTerminalSelection(term, true)) {
      void pasteIntoTerminal(term)
    }
  }

  // Optional copy-on-selection. xterm's onSelectionChange fires repeatedly
  // while a drag grows the selection, so we debounce: copy once the selection
  // settles. No long-lived text dedup — re-selecting the same text always
  // re-asserts it onto the clipboard (the clipboard may have changed in
  // another app since).
  let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null
  const selectionDisposable = term.onSelectionChange(() => {
    if (!useSettingsStore.getState().settings.copyOnSelection) return
    if (selectionCopyTimer) clearTimeout(selectionCopyTimer)
    selectionCopyTimer = setTimeout(() => {
      selectionCopyTimer = null
      if (term.hasSelection()) copyTerminalSelection(term)
    }, 120)
  })

  // Create a persistent wrapper element for the xterm DOM
  const wrapperEl = document.createElement('div')
  wrapperEl.style.width = '100%'
  wrapperEl.style.height = '100%'
  wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'
  wrapperEl.addEventListener('contextmenu', onContextMenu)

  term.open(wrapperEl)

  const entry: TerminalEntry = {
    term,
    fitAddon,
    ptyId: null,
    wrapperEl,
    truecolorNormalizer: new TruecolorSgrNormalizer(),
    ready: false,
    creating: false,
    cleanupIpc: null,
    disposeExtras: () => {
      if (selectionCopyTimer) clearTimeout(selectionCopyTimer)
      selectionDisposable.dispose()
      modifyOtherKeysDisposable.dispose()
      osc52Disposable.dispose()
      wrapperEl.removeEventListener('contextmenu', onContextMenu)
    }
  }

  registry.set(terminalId, entry)
  return entry
}

export function getTerminalEntry(terminalId: string): TerminalEntry | undefined {
  return registry.get(terminalId)
}

// ── Pending exit handlers ───────────────────────────────────────────────
// Callers (e.g. worktree setup-script flow) may want to react to a
// terminal's PTY exit without waiting for useTerminal to mount and resolve
// the ptyId. Registering here is unconditional: the handler fires on the
// first of (a) PTY exit reported by useTerminal, or (b) destroyTerminal()
// for cases where the tab never mounted. After firing, it's cleared.

type PendingExitHandler = (exitCode: number) => void
const pendingExitHandlers = new Map<string, PendingExitHandler>()

export function registerExitHandler(terminalId: string, handler: PendingExitHandler): () => void {
  pendingExitHandlers.set(terminalId, handler)
  return () => {
    if (pendingExitHandlers.get(terminalId) === handler) {
      pendingExitHandlers.delete(terminalId)
    }
  }
}

/** Invoke and clear any pending exit handler for a terminal. Idempotent. */
export function fireExitHandler(terminalId: string, exitCode: number): void {
  const handler = pendingExitHandlers.get(terminalId)
  if (!handler) return
  pendingExitHandlers.delete(terminalId)
  try {
    handler(exitCode)
  } catch {
    /* isolate handler errors */
  }
}

export function destroyTerminal(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (!entry) {
    // Even if the entry never got registered, fire any pending handler so
    // callers waiting on an exit result get unblocked with a synthetic code.
    fireExitHandler(terminalId, -1)
    return
  }

  if (entry.cleanupIpc) entry.cleanupIpc()
  if (entry.disposeExtras) entry.disposeExtras()
  if (entry.ptyId) window.dplex.pty.destroy(entry.ptyId)
  entry.term.dispose()
  entry.wrapperEl.remove()
  registry.delete(terminalId)
  // If useTerminal hadn't yet wired pty:exit (fast destroy before PTY
  // resolved), still fire pending handlers so tmp files get cleaned up.
  fireExitHandler(terminalId, -1)
}

export function isTerminalRegistered(terminalId: string): boolean {
  return registry.has(terminalId)
}

export function fitTerminal(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  try {
    entry.fitAddon.fit()
  } catch {
    // ignore
  }
}

export function updateTerminalFont(terminalId: string, fontSize: number, fontFamily: string): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  entry.term.options.fontSize = fontSize
  entry.term.options.fontFamily = fontFamily
  try {
    entry.fitAddon.fit()
  } catch {
    // ignore
  }
}

export function updateTerminalMacOptionIsMeta(terminalId: string, macOptionIsMeta: boolean): void {
  const entry = registry.get(terminalId)
  if (!entry) return
  entry.term.options.macOptionIsMeta = macOptionIsMeta
}

export function applyThemeToAll(themeId: string): void {
  const appTheme = getTheme(themeId)
  for (const [, entry] of registry) {
    entry.term.options.theme = appTheme.terminal
    entry.wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'
  }
}
