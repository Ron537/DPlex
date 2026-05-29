import { describe, expect, it } from 'vitest'
import { shouldBlockShortcut, type ShortcutInput } from '../../src/main/windowShortcuts'

function input(overrides: Partial<ShortcutInput> = {}): ShortcutInput {
  return {
    type: 'keyDown',
    code: '',
    control: false,
    meta: false,
    shift: false,
    ...overrides
  }
}

describe('shouldBlockShortcut', () => {
  it('allows Ctrl+R through to the terminal in packaged builds', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyR', control: true }))).toBe(false)
  })

  it('allows Cmd+R through to the terminal in packaged builds', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyR', meta: true }))).toBe(false)
  })

  it("blocks Chromium's zoom-out (Cmd/Ctrl + -)", () => {
    expect(shouldBlockShortcut(input({ code: 'Minus', control: true }))).toBe(true)
    expect(shouldBlockShortcut(input({ code: 'Minus', meta: true }))).toBe(true)
  })

  it("blocks Chromium's zoom-in (Cmd/Ctrl + Shift + =)", () => {
    expect(shouldBlockShortcut(input({ code: 'Equal', control: true, shift: true }))).toBe(true)
  })

  it('does not block non-keyDown events', () => {
    expect(shouldBlockShortcut(input({ type: 'keyUp', code: 'Minus', control: true }))).toBe(false)
  })

  it('does not block plain typing', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyA' }))).toBe(false)
    expect(shouldBlockShortcut(input({ code: 'Enter' }))).toBe(false)
  })
})
