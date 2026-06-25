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
  pasteIntoTerminal,
  shouldSuppressPaste
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
    // AI CLIs (Copilot/Claude) enable mouse tracking, which by default disables
    // xterm's own text selection (every gesture is forwarded to the PTY). With
    // this option, plain drag / double-click word / triple-click line selection
    // work natively, and mouse events only reach the app when Alt is held; wheel
    // scroll still passes through. This is what makes copy work in AI panes (#86).
    mouseEventsRequireAlt: isAiPane,
    scrollback: 10000
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  // TEMP (#86 verify): dev-only proof of which build is running. If you don't
  // see `mouseEventsRequireAlt:true` for an AI pane, you're on a stale bundle —
  // stop `npm run dev`, delete node_modules/.vite, reinstall, and restart.
  if (import.meta.env.DEV) {
    console.log('[dplex:clipboard] build-check', {
      terminalId,
      isAiPane,
      mouseEventsRequireAlt: term.options.mouseEventsRequireAlt,
      buildTag: 'native-selection-v2'
    })
  }

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

  // ── Copy / paste wiring (issue #86) ───────────────────────────────────
  // With `mouseEventsRequireAlt` (set in the Terminal options above for AI
  // panes), xterm keeps its own selection service active under mouse tracking,
  // so drag / double-click word / triple-click line selection all work natively.
  // Copy therefore just reads `term.getSelection()` — no buffer reconstruction
  // or pixel→cell math needed. `lastCopyAt` backs the post-copy paste guard.
  let lastCopyAt = 0
  // Copy the current native selection. Returns true when something
  // non-whitespace was copied. The raw selection is written verbatim (internal
  // whitespace may be meaningful); only the accept/reject test trims.
  const copySelection = (clearAfter = true): boolean => {
    if (!term.hasSelection()) return false
    const text = term.getSelection()
    if (!text.trim()) return false
    window.dplex.clipboard.writeText(text)
    if (clearAfter) term.clearSelection()
    lastCopyAt = Date.now()
    return true
  }

  // Copy/paste + (macOS) word-motion + Shift+Enter key handling. xterm allows a
  // single custom key handler, so these concerns share one. Returning false
  // stops xterm from forwarding the key to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    const action = clipboardKeyAction(e, {
      isMac,
      hasSelection: term.hasSelection()
    })
    if (action === 'copy') {
      e.preventDefault()
      copySelection()
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

  // Right-click: copy the selection, or paste when there's nothing selected —
  // Windows Terminal's default. A post-copy guard stops a confirming second
  // right-click from pasting the just-copied text back into the prompt. With
  // `mouseEventsRequireAlt`, a plain right-click in an AI pane is not forwarded
  // to the PTY, so there's no double-paste to guard against here.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    // Any selection means the user is copying — copy it (a whitespace-only
    // selection is a no-op) and never fall through to paste their clipboard.
    if (term.hasSelection()) {
      copySelection()
      return
    }
    if (shouldSuppressPaste(lastCopyAt, Date.now())) return
    void pasteIntoTerminal(term)
  }

  // Optional copy-on-selection: mirror a settled native selection to the
  // clipboard. xterm fires this repeatedly during a drag, so debounce.
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

  term.open(wrapperEl)

  // Capture phase so we run before xterm's own inner-element contextmenu
  // handling and can drive right-click copy/paste ourselves.
  wrapperEl.addEventListener('contextmenu', onContextMenu, true)

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
      wrapperEl.removeEventListener('contextmenu', onContextMenu, true)
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
