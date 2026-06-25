import { describe, expect, it } from 'vitest'
import {
  clipboardKeyAction,
  cellFromPixel,
  readBufferRange,
  selectionLength,
  isDrag,
  resolveCopyText,
  shouldSuppressPaste,
  type ClipboardKeyEvent,
  type BufferLike
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

// ── AI-pane helpers (issue #86) ──────────────────────────────────────────

/** Build a fake xterm buffer from plain-string rows for readBufferRange. */
function fakeBuffer(rows: string[]): BufferLike {
  return {
    getLine(row: number) {
      const line = rows[row]
      if (line === undefined) return undefined
      return {
        translateToString(trimRight = false, startColumn = 0, endColumn?: number) {
          const end = endColumn ?? line.length
          const slice = line.slice(startColumn, end)
          return trimRight ? slice.replace(/\s+$/u, '') : slice
        }
      }
    }
  }
}

describe('cellFromPixel', () => {
  const rect = { left: 10, top: 20 }
  const dims = { cellWidth: 8, cellHeight: 16 }

  it('maps a pixel to a viewport cell, offset by viewportY', () => {
    // (clientX-left)/w = (10-10)/8 = 0 ; (clientY-top)/h = (52-20)/16 = 2
    expect(cellFromPixel(10, 52, rect, dims, 80, 24, 100)).toEqual({ col: 0, row: 102 })
  })

  it('rounds the column at the half-cell (caret boundary)', () => {
    // left edge of cell 2 → boundary 2; right half of cell 2 → boundary 3
    expect(cellFromPixel(10 + 2 * 8, 20, rect, dims, 80, 24, 0)?.col).toBe(2)
    expect(cellFromPixel(10 + 2 * 8 + 5, 20, rect, dims, 80, 24, 0)?.col).toBe(3)
    expect(cellFromPixel(10 + 2 * 8 + 3, 20, rect, dims, 80, 24, 0)?.col).toBe(2)
  })

  it('allows the column to reach cols (selection through the final column)', () => {
    expect(cellFromPixel(99999, 20, rect, dims, 80, 24, 0)?.col).toBe(80)
  })

  it('clamps row to the last row and floors negatives to zero', () => {
    expect(cellFromPixel(99999, 99999, rect, dims, 80, 24, 0)).toEqual({ col: 80, row: 23 })
    expect(cellFromPixel(-100, -100, rect, dims, 80, 24, 0)).toEqual({ col: 0, row: 0 })
  })

  it('fails closed (null) when cell dimensions are unavailable', () => {
    expect(cellFromPixel(10, 52, rect, { cellWidth: 0, cellHeight: 16 }, 80, 24, 0)).toBeNull()
  })
})

describe('readBufferRange', () => {
  const buf = fakeBuffer(['first line', 'second line', 'third line'])

  it('reads a single-row range with trailing trim', () => {
    expect(readBufferRange(buf, { col: 0, row: 0 }, { col: 5, row: 0 })).toBe('first')
  })

  it('joins multi-row ranges with newlines', () => {
    expect(readBufferRange(buf, { col: 6, row: 0 }, { col: 6, row: 2 })).toBe(
      'line\nsecond line\nthird'
    )
  })

  it('normalizes reversed start/end order', () => {
    const fwd = readBufferRange(buf, { col: 0, row: 0 }, { col: 6, row: 1 })
    const rev = readBufferRange(buf, { col: 6, row: 1 }, { col: 0, row: 0 })
    expect(rev).toBe(fwd)
  })

  it('returns empty string for missing lines', () => {
    expect(readBufferRange(buf, { col: 0, row: 9 }, { col: 3, row: 9 })).toBe('')
  })
})

describe('selectionLength', () => {
  it('computes single-row length', () => {
    expect(selectionLength({ col: 2, row: 0 }, { col: 7, row: 0 }, 80)).toBe(5)
  })

  it('computes multi-row length using cols', () => {
    expect(selectionLength({ col: 0, row: 0 }, { col: 0, row: 1 }, 80)).toBe(80)
  })

  it('is order-independent', () => {
    expect(selectionLength({ col: 7, row: 1 }, { col: 2, row: 0 }, 80)).toBe(
      selectionLength({ col: 2, row: 0 }, { col: 7, row: 1 }, 80)
    )
  })
})

describe('isDrag', () => {
  it('treats movement under the threshold as a click', () => {
    expect(isDrag(2, 2)).toBe(false)
  })
  it('treats movement over the threshold as a drag', () => {
    expect(isDrag(5, 5)).toBe(true)
  })
})

describe('resolveCopyText', () => {
  it('prefers a non-whitespace native selection verbatim', () => {
    expect(resolveCopyText('  hello  ', 'snap')).toBe('  hello  ')
  })

  it('falls back to the snapshot when native is empty/whitespace', () => {
    expect(resolveCopyText('   ', 'snapshot text')).toBe('snapshot text')
    expect(resolveCopyText(null, 'snapshot text')).toBe('snapshot text')
  })

  it('trims trailing whitespace from the snapshot', () => {
    expect(resolveCopyText(null, 'snap   ')).toBe('snap')
  })

  it('returns null when neither candidate has content', () => {
    expect(resolveCopyText(null, null)).toBeNull()
    expect(resolveCopyText('   ', '   ')).toBeNull()
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
