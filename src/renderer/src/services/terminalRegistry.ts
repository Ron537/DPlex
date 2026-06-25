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
  cellFromPixel,
  readBufferRange,
  selectionLength,
  isDrag,
  resolveCopyText,
  shouldSuppressPaste,
  type BufferCell,
  type BufferLike
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

  // ── AI-pane clipboard takeover (issue #86) ────────────────────────────
  // When an AI CLI (Copilot/Claude) enables mouse tracking, xterm forwards
  // drags to the PTY and `term.hasSelection()` is always false — so the
  // selection-based copy paths fail silently. For AI panes we reconstruct the
  // dragged text from the buffer (`pendingCopyText`) and paint a visible
  // selection. Non-AI panes keep native behavior (Shift+drag still forces a
  // local xterm selection under mouse mode).
  const PENDING_COPY_TTL_MS = 3000
  let pendingCopyText: string | null = null
  let pendingCopyTimer: ReturnType<typeof setTimeout> | null = null
  let lastCopyAt = 0
  let dragStartPos: { x: number; y: number } | null = null
  // Set while applying a programmatic `term.select()` so the copy-on-selection
  // listener doesn't auto-copy a selection the user didn't make by hand.
  let suppressSelectionCopy = false
  // Handle for the deferred AI-pane selection paint, tracked so disposal can
  // cancel a paint scheduled in the same tick as a teardown.
  let deferredSelectTimer: ReturnType<typeof setTimeout> | null = null

  const clearPendingCopy = (): void => {
    pendingCopyText = null
    if (pendingCopyTimer) {
      clearTimeout(pendingCopyTimer)
      pendingCopyTimer = null
    }
  }
  const snapshotCopy = (text: string): void => {
    pendingCopyText = text
    if (pendingCopyTimer) clearTimeout(pendingCopyTimer)
    pendingCopyTimer = setTimeout(clearPendingCopy, PENDING_COPY_TTL_MS)
  }
  // Copy the native selection or, failing that, the buffer snapshot. Returns
  // true when something non-whitespace was copied.
  const copyResolved = (): boolean => {
    const native = term.hasSelection() ? term.getSelection() : null
    const text = resolveCopyText(native, pendingCopyText)
    if (!text) return false
    window.dplex.clipboard.writeText(text)
    lastCopyAt = Date.now()
    term.clearSelection()
    clearPendingCopy()
    return true
  }

  // Internal xterm access for pixel→cell mapping, isolated and fail-closed so a
  // future xterm upgrade only touches here.
  const getCellDims = (): { cellWidth: number; cellHeight: number } | null => {
    const core = (
      term as unknown as {
        _core?: {
          _renderService?: {
            dimensions?: {
              css?: { cell?: { width: number; height: number } }
              actualCellWidth?: number
              actualCellHeight?: number
            }
          }
        }
      }
    )._core
    const dim = core?._renderService?.dimensions
    const cellWidth = dim?.css?.cell?.width ?? dim?.actualCellWidth ?? 0
    const cellHeight = dim?.css?.cell?.height ?? dim?.actualCellHeight ?? 0
    if (!cellWidth || !cellHeight) return null
    return { cellWidth, cellHeight }
  }
  const pixelToCell = (clientX: number, clientY: number): BufferCell | null => {
    const screen = wrapperEl.querySelector('.xterm-screen') as HTMLElement | null
    if (!screen) return null
    const dims = getCellDims()
    if (!dims) return null
    const rect = screen.getBoundingClientRect()
    return cellFromPixel(
      clientX,
      clientY,
      rect,
      dims,
      term.cols,
      term.rows,
      term.buffer.active.viewportY
    )
  }

  // Copy/paste + (macOS) word-motion + Shift+Enter key handling. xterm allows a
  // single custom key handler, so these concerns share one. Returning false
  // stops xterm from forwarding the key to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    // Treat a buffer snapshot as a selection so Ctrl+C copies it under mouse
    // mode (where term.hasSelection() is false) instead of sending SIGINT.
    const action = clipboardKeyAction(e, {
      isMac,
      hasSelection: term.hasSelection() || !!pendingCopyText
    })
    if (action === 'copy') {
      e.preventDefault()
      copyResolved()
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

  // Right-click: copy the selection/snapshot, or paste when there's nothing to
  // copy — Windows Terminal's default. A post-copy guard stops a confirming
  // second right-click from pasting the just-copied text back into the prompt.
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (copyResolved()) return
    if (shouldSuppressPaste(lastCopyAt, Date.now())) return
    void pasteIntoTerminal(term)
  }

  // Optional copy-on-selection. xterm's onSelectionChange fires repeatedly
  // while a drag grows the selection, so we debounce: copy once the selection
  // settles. No long-lived text dedup — re-selecting the same text always
  // re-asserts it onto the clipboard (the clipboard may have changed in
  // another app since). Programmatic selections (our AI-pane paint) are skipped
  // via suppressSelectionCopy so a TUI drag never auto-writes the clipboard.
  let selectionCopyTimer: ReturnType<typeof setTimeout> | null = null
  const selectionDisposable = term.onSelectionChange(() => {
    if (suppressSelectionCopy) return
    if (!useSettingsStore.getState().settings.copyOnSelection) return
    if (selectionCopyTimer) clearTimeout(selectionCopyTimer)
    selectionCopyTimer = setTimeout(() => {
      selectionCopyTimer = null
      if (term.hasSelection()) copyTerminalSelection(term)
    }, 120)
  })

  // User input or focus loss invalidates a stale buffer snapshot so a later
  // right-click pastes (rather than re-copying old dragged text). The 3s TTL is
  // only a safety net on top of these.
  const dataInvalidateDisposable = term.onData(() => {
    if (pendingCopyText) clearPendingCopy()
  })

  // Right mouse button: snapshot any existing selection (double/triple-click
  // word/line selections get cleared by the click before contextmenu reads
  // them), and — in AI panes — suppress xterm's own forwarding so the click
  // isn't ALSO delivered to the PTY (which caused the double-paste in #86).
  const handleRightButton = (e: MouseEvent): void => {
    if (e.button !== 2) return
    if (e.type === 'mousedown' && term.hasSelection()) {
      const sel = term.getSelection().replace(/\s+$/u, '')
      if (sel) snapshotCopy(sel)
    }
    if (isAiPane) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Left mouse button: track drags. In an AI pane, mouse tracking swallows the
  // native selection, so on a drag with no resulting xterm selection we read
  // the dragged text straight from the buffer (snapshot for copy) and paint a
  // visible selection — matching Windows Terminal.
  const handleLeftDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    dragStartPos = { x: e.clientX, y: e.clientY }
    clearPendingCopy()
  }
  const handleLeftUp = (e: MouseEvent): void => {
    if (e.button !== 0 || !dragStartPos) return
    const start = dragStartPos
    dragStartPos = null
    if (!isDrag(e.clientX - start.x, e.clientY - start.y)) return
    // Only take over in AI panes; real TUIs (vim/htop) keep their mouse, and
    // plain shells select natively. A native xterm selection always wins.
    if (!isAiPane || term.hasSelection()) return
    const startCell = pixelToCell(start.x, start.y)
    const endCell = pixelToCell(e.clientX, e.clientY)
    if (!startCell || !endCell) return
    const snapshot = readBufferRange(
      term.buffer.active as unknown as BufferLike,
      startCell,
      endCell
    ).replace(/\s+$/u, '')
    if (snapshot) snapshotCopy(snapshot)
    const len = selectionLength(startCell, endCell, term.cols)
    if (len <= 0) return
    let s = startCell
    let en = endCell
    if (s.row > en.row || (s.row === en.row && s.col > en.col)) {
      const tmp = s
      s = en
      en = tmp
    }
    const selCol = s.col
    const selRow = s.row
    // Defer past this event cycle: our capture-phase listener runs before
    // xterm's bubble-phase mouseup, which would otherwise reset the selection.
    if (deferredSelectTimer) clearTimeout(deferredSelectTimer)
    deferredSelectTimer = setTimeout(() => {
      deferredSelectTimer = null
      suppressSelectionCopy = true
      try {
        term.select(selCol, selRow, len)
      } catch {
        // Selection service may have shifted (resize/scroll) — non-fatal.
      } finally {
        suppressSelectionCopy = false
      }
    }, 0)
  }
  const onFocusOut = (): void => clearPendingCopy()

  // Create a persistent wrapper element for the xterm DOM
  const wrapperEl = document.createElement('div')
  wrapperEl.style.width = '100%'
  wrapperEl.style.height = '100%'
  wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'

  term.open(wrapperEl)

  // Capture phase so we run before (and can stop) xterm's own inner-element
  // mouse handlers. Left-button events are NOT stopped — xterm still does its
  // native selection / mouse reporting; we only read coordinates.
  wrapperEl.addEventListener('mousedown', handleRightButton, true)
  wrapperEl.addEventListener('mouseup', handleRightButton, true)
  wrapperEl.addEventListener('mousedown', handleLeftDown, true)
  wrapperEl.addEventListener('mouseup', handleLeftUp, true)
  wrapperEl.addEventListener('contextmenu', onContextMenu, true)
  wrapperEl.addEventListener('focusout', onFocusOut)

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
      if (pendingCopyTimer) clearTimeout(pendingCopyTimer)
      if (deferredSelectTimer) clearTimeout(deferredSelectTimer)
      selectionDisposable.dispose()
      dataInvalidateDisposable.dispose()
      modifyOtherKeysDisposable.dispose()
      wrapperEl.removeEventListener('mousedown', handleRightButton, true)
      wrapperEl.removeEventListener('mouseup', handleRightButton, true)
      wrapperEl.removeEventListener('mousedown', handleLeftDown, true)
      wrapperEl.removeEventListener('mouseup', handleLeftUp, true)
      wrapperEl.removeEventListener('contextmenu', onContextMenu, true)
      wrapperEl.removeEventListener('focusout', onFocusOut)
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
