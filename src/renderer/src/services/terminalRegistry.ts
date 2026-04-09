import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'

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

export interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  wrapperEl: HTMLDivElement
  ready: boolean
  cleanupIpc: (() => void) | null
}

// Global registry — lives outside React lifecycle
const registry = new Map<string, TerminalEntry>()

export function getOrCreateTerminal(
  terminalId: string,
  fontSize: number,
  fontFamily: string
): TerminalEntry {
  const existing = registry.get(terminalId)
  if (existing) return existing

  const term = new Terminal({
    fontFamily,
    fontSize,
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

  // Create a persistent wrapper element for the xterm DOM
  const wrapperEl = document.createElement('div')
  wrapperEl.style.width = '100%'
  wrapperEl.style.height = '100%'

  term.open(wrapperEl)

  const entry: TerminalEntry = {
    term,
    fitAddon,
    ptyId: null,
    wrapperEl,
    ready: false,
    cleanupIpc: null
  }

  registry.set(terminalId, entry)
  return entry
}

export function getTerminalEntry(terminalId: string): TerminalEntry | undefined {
  return registry.get(terminalId)
}

export function destroyTerminal(terminalId: string): void {
  const entry = registry.get(terminalId)
  if (!entry) return

  if (entry.cleanupIpc) entry.cleanupIpc()
  if (entry.ptyId) window.tplex.pty.destroy(entry.ptyId)
  entry.term.dispose()
  entry.wrapperEl.remove()
  registry.delete(terminalId)
}

export function isTerminalRegistered(terminalId: string): boolean {
  return registry.has(terminalId)
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
