import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { getTheme } from './themes'

export interface TerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  ptyId: string | null
  wrapperEl: HTMLDivElement
  ready: boolean
  creating: boolean
  cleanupIpc: (() => void) | null
}

// Global registry — lives outside React lifecycle
const registry = new Map<string, TerminalEntry>()

export function getOrCreateTerminal(
  terminalId: string,
  fontSize: number,
  fontFamily: string,
  themeId?: string
): TerminalEntry {
  const existing = registry.get(terminalId)
  if (existing) return existing

  const appTheme = getTheme(themeId || 'midnight')

  const term = new Terminal({
    fontFamily,
    fontSize,
    theme: appTheme.terminal,
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
  wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'

  term.open(wrapperEl)

  const entry: TerminalEntry = {
    term,
    fitAddon,
    ptyId: null,
    wrapperEl,
    ready: false,
    creating: false,
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
  if (entry.ptyId) window.dplex.pty.destroy(entry.ptyId)
  entry.term.dispose()
  entry.wrapperEl.remove()
  registry.delete(terminalId)
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

export function applyThemeToAll(themeId: string): void {
  const appTheme = getTheme(themeId)
  for (const [, entry] of registry) {
    entry.term.options.theme = appTheme.terminal
    entry.wrapperEl.style.backgroundColor = appTheme.terminal.background || '#000'
  }
}
