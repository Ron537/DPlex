import { describe, expect, it } from 'vitest'
import {
  clipboardKeyAction,
  shouldSuppressPaste,
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

  it('plain Ctrl+V is NOT hijacked (readline quoted-insert)', () => {
    expect(clipboardKeyAction(keyEvent({ ctrlKey: true, key: 'v' }), opts(false))).toBe('none')
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

describe('shouldSuppressPaste', () => {
  it('suppresses a paste within the guard window of a copy', () => {
    expect(shouldSuppressPaste(1000, 1300, 600)).toBe(true)
  })
  it('allows a paste after the guard window', () => {
    expect(shouldSuppressPaste(1000, 1700, 600)).toBe(false)
  })
  it('never suppresses when no copy has happened', () => {
    expect(shouldSuppressPaste(0, 500, 600)).toBe(false)
  })
})
