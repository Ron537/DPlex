import { describe, expect, it } from 'vitest'
import {
  wordMotionSequence,
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
