import { describe, expect, it } from 'vitest'
import {
  clipboardKeyAction,
  parseOsc52,
  type ClipboardKeyEvent
} from '../../src/renderer/src/services/terminalClipboard'

function keyEvent(overrides: Partial<ClipboardKeyEvent> = {}): ClipboardKeyEvent {
  return {
    type: 'keydown',
    key: 'c',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides
  }
}

describe('clipboardKeyAction — Windows/Linux', () => {
  const opts = (hasSelection: boolean): { isMac: boolean; hasSelection: boolean } => ({
    isMac: false,
    hasSelection
  })

  it('Ctrl+C copies when text is selected', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'c' }), opts(true))).toBe('copy')
  })

  it('Ctrl+C is left alone (SIGINT) when nothing is selected', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'c' }), opts(false))).toBe('none')
  })

  it('Ctrl+Shift+C copies with a selection', () => {
    expect(
      clipboardKeyAction(keyEvent({ ctrlKey: true, shiftKey: true, key: 'c' }), opts(true))
    ).toBe('copy')
  })

  it('Ctrl+Shift+C does nothing without a selection (so it never sends SIGINT)', () => {
    expect(
      clipboardKeyAction(keyEvent({ ctrlKey: true, shiftKey: true, key: 'c' }), opts(false))
    ).toBe('none')
  })

  it('Ctrl+Shift+V pastes', () => {
    expect(
      clipboardKeyAction(keyEvent({ ctrlKey: true, shiftKey: true, key: 'v' }), opts(false))
    ).toBe('paste')
  })

  it('plain Ctrl+V is NOT hijacked in a plain shell (readline quoted-insert)', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'v' }), opts(false))).toBe('none')
  })

  it("plain Ctrl+V pastes in an AI pane (CLI can't read the clipboard itself)", () => {
    expect(
      clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'v' }), {
        isMac: false,
        hasSelection: false,
        isAiPane: true
      })
    ).toBe('paste')
  })

  it('plain Ctrl+C in an AI pane still sends SIGINT when nothing is selected', () => {
    expect(
      clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'c' }), {
        isMac: false,
        hasSelection: false,
        isAiPane: true
      })
    ).toBe('none')
  })

  it('uppercase key (caps lock / shift) still matches', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'C' }), opts(true))).toBe('copy')
  })

  it('ignores key repeats that are not keydown', () => {
    expect(
      clipboardKeyAction(keyEvent({ type: 'keyup', ctrlKey: true, key: 'c' }), opts(true))
    ).toBe('none')
  })

  it('does not treat ⌘C as copy on non-mac', () => {
    expect(clipboardKeyAction(keyEvent({ metaKey: true, key: 'c' }), opts(true))).toBe('none')
  })
})

describe('clipboardKeyAction — macOS', () => {
  const opts = (hasSelection: boolean): { isMac: boolean; hasSelection: boolean } => ({
    isMac: true,
    hasSelection
  })

  it('⌘C copies when text is selected', () => {
    expect(clipboardKeyAction(keyEvent({ metaKey: true, key: 'c' }), opts(true))).toBe('copy')
  })

  it('⌘C does nothing without a selection', () => {
    expect(clipboardKeyAction(keyEvent({ metaKey: true, key: 'c' }), opts(false))).toBe('none')
  })

  it('⌘V pastes', () => {
    expect(clipboardKeyAction(keyEvent({ metaKey: true, key: 'v' }), opts(false))).toBe('paste')
  })

  it('Ctrl+C is left alone so it still sends SIGINT', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'c' }), opts(true))).toBe('none')
  })

  it('⌥-modified ⌘C is not treated as copy (different chord)', () => {
    expect(
      clipboardKeyAction(keyEvent({ metaKey: true, altKey: true, key: 'c' }), opts(true))
    ).toBe('none')
  })
})

describe('parseOsc52', () => {
  const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

  it('decodes a clipboard (c) write payload', () => {
    expect(parseOsc52(`c;${b64('hello world')}`)).toBe('hello world')
  })

  it('decodes UTF-8 / multibyte content correctly', () => {
    const s = '▘▝ █  Check for mistakes. — café'
    expect(parseOsc52(`c;${b64(s)}`)).toBe(s)
  })

  it('ignores read requests (Pd = "?")', () => {
    expect(parseOsc52('c;?')).toBeNull()
  })

  it('accepts an empty selection parameter (";<base64>")', () => {
    expect(parseOsc52(`;${b64('primary')}`)).toBe('primary')
  })

  it('handles multi-target selection parameters (e.g. "pc")', () => {
    expect(parseOsc52(`pc;${b64('both')}`)).toBe('both')
  })

  it('returns null when there is no separator', () => {
    expect(parseOsc52('cnope')).toBeNull()
  })

  it('returns null for an empty payload', () => {
    expect(parseOsc52('c;')).toBeNull()
  })

  it('returns null for malformed base64', () => {
    expect(parseOsc52('c;@@@not base64@@@')).toBeNull()
  })
})
