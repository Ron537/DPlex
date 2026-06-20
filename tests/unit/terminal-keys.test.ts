import { describe, expect, it } from 'vitest'
import {
  wordMotionSequence,
  shiftEnterSequence,
  modifyOtherKeysActive,
  SHIFT_ENTER_SEQUENCE,
  type WordMotionKeyEvent
} from '../../src/renderer/src/utils/terminalKeys'

/** Builds an ⌥+ArrowLeft keydown event, overridable per test. */
function keyEvent(overrides: Partial<WordMotionKeyEvent> = {}): WordMotionKeyEvent {
  return {
    type: 'keydown',
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'ArrowLeft',
    ...overrides
  }
}

describe('wordMotionSequence', () => {
  it('maps ⌥+ArrowLeft to backward-word (ESC b)', () => {
    expect(wordMotionSequence(keyEvent({ key: 'ArrowLeft' }))).toBe('\x1bb')
  })

  it('maps ⌥+ArrowRight to forward-word (ESC f)', () => {
    expect(wordMotionSequence(keyEvent({ key: 'ArrowRight' }))).toBe('\x1bf')
  })

  it('maps ⌥+Backspace to backward-kill-word (ESC DEL)', () => {
    expect(wordMotionSequence(keyEvent({ key: 'Backspace' }))).toBe('\x1b\x7f')
  })

  it('maps ⌥+Delete to kill-word forward (ESC d)', () => {
    expect(wordMotionSequence(keyEvent({ key: 'Delete' }))).toBe('\x1bd')
  })

  it('returns null without the Alt modifier', () => {
    expect(wordMotionSequence(keyEvent({ altKey: false }))).toBeNull()
  })

  it('returns null when Ctrl or Meta is also held', () => {
    expect(wordMotionSequence(keyEvent({ ctrlKey: true }))).toBeNull()
    expect(wordMotionSequence(keyEvent({ metaKey: true }))).toBeNull()
  })

  it('returns null when Shift is held so xterm handles the combination', () => {
    expect(wordMotionSequence(keyEvent({ shiftKey: true }))).toBeNull()
  })

  it('returns null for non-keydown events', () => {
    expect(wordMotionSequence(keyEvent({ type: 'keyup' }))).toBeNull()
    expect(wordMotionSequence(keyEvent({ type: 'keypress' }))).toBeNull()
  })

  it('returns null for keys without a word motion', () => {
    expect(wordMotionSequence(keyEvent({ key: 'ArrowUp' }))).toBeNull()
    expect(wordMotionSequence(keyEvent({ key: 'a' }))).toBeNull()
  })
})

/** Builds a Shift+Enter keydown event, overridable per test. */
function shiftEnterEvent(overrides: Partial<WordMotionKeyEvent> = {}): WordMotionKeyEvent {
  return {
    type: 'keydown',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    key: 'Enter',
    ...overrides
  }
}

describe('shiftEnterSequence', () => {
  it('encodes Shift+Enter as modifyOtherKeys when the mode is active', () => {
    expect(shiftEnterSequence(shiftEnterEvent(), true)).toBe(SHIFT_ENTER_SEQUENCE)
    expect(SHIFT_ENTER_SEQUENCE).toBe('\x1b[27;2;13~')
  })

  it('returns null when modifyOtherKeys is not active', () => {
    expect(shiftEnterSequence(shiftEnterEvent(), false)).toBeNull()
  })

  it('returns null without the Shift modifier (plain Enter submits)', () => {
    expect(shiftEnterSequence(shiftEnterEvent({ shiftKey: false }), true)).toBeNull()
  })

  it('returns null when Ctrl, Alt, or Meta is also held', () => {
    expect(shiftEnterSequence(shiftEnterEvent({ ctrlKey: true }), true)).toBeNull()
    expect(shiftEnterSequence(shiftEnterEvent({ altKey: true }), true)).toBeNull()
    expect(shiftEnterSequence(shiftEnterEvent({ metaKey: true }), true)).toBeNull()
  })

  it('returns null for non-Enter keys', () => {
    expect(shiftEnterSequence(shiftEnterEvent({ key: 'a' }), true)).toBeNull()
  })

  it('returns null for non-keydown events', () => {
    expect(shiftEnterSequence(shiftEnterEvent({ type: 'keyup' }), true)).toBeNull()
    expect(shiftEnterSequence(shiftEnterEvent({ type: 'keypress' }), true)).toBeNull()
  })
})

describe('modifyOtherKeysActive', () => {
  it('enables on CSI > 4 ; 2 m (mode 2)', () => {
    expect(modifyOtherKeysActive([4, 2])).toBe(true)
  })

  it('enables on mode 1', () => {
    expect(modifyOtherKeysActive([4, 1])).toBe(true)
  })

  it('disables on reset (CSI > 4 m, no mode)', () => {
    expect(modifyOtherKeysActive([4])).toBe(false)
  })

  it('disables on mode 0 (CSI > 4 ; 0 m)', () => {
    expect(modifyOtherKeysActive([4, 0])).toBe(false)
  })

  it('disables on the reset-all form CSI > m (xterm represents it as [0])', () => {
    expect(modifyOtherKeysActive([0])).toBe(false)
    expect(modifyOtherKeysActive([0, 1])).toBe(false)
  })

  it('returns null (leave state unchanged) for unrelated key-modifier resources', () => {
    expect(modifyOtherKeysActive([1])).toBeNull()
    expect(modifyOtherKeysActive([2, 2])).toBeNull()
    expect(modifyOtherKeysActive([])).toBeNull()
  })

  it('reads the leading value of sub-parameter arrays', () => {
    expect(modifyOtherKeysActive([[4], [2]])).toBe(true)
    expect(modifyOtherKeysActive([[4], [0]])).toBe(false)
  })
})
