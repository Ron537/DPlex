import { describe, expect, it } from 'vitest'
import { shouldBlockShortcut, type ShortcutInput } from '../../src/main/windowShortcuts'

function input(overrides: Partial<ShortcutInput> = {}): ShortcutInput {
  return {
    type: 'keyDown',
    code: '',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides
  }
}

describe('shouldBlockShortcut', () => {
  it('allows Ctrl+R through to the terminal in packaged builds', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyR', control: true }), { isDev: false })).toBe(
      false
    )
  })

  it('allows Cmd+R through to the terminal in packaged builds', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyR', meta: true }), { isDev: false })).toBe(false)
  })

  it('allows Ctrl+R through in dev builds too', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyR', control: true }), { isDev: true })).toBe(false)
  })

  it('blocks the DevTools accelerator (Cmd+Alt+I) in production', () => {
    expect(
      shouldBlockShortcut(input({ code: 'KeyI', alt: true, meta: true }), { isDev: false })
    ).toBe(true)
  })

  it('blocks the DevTools accelerator (Ctrl+Shift+I) in production', () => {
    expect(
      shouldBlockShortcut(input({ code: 'KeyI', control: true, shift: true }), { isDev: false })
    ).toBe(true)
  })

  it('lets the DevTools accelerator through in dev mode', () => {
    expect(
      shouldBlockShortcut(input({ code: 'KeyI', control: true, shift: true }), { isDev: true })
    ).toBe(false)
  })

  it("blocks Chromium's zoom-out (Cmd/Ctrl + -)", () => {
    expect(shouldBlockShortcut(input({ code: 'Minus', control: true }), { isDev: false })).toBe(
      true
    )
    expect(shouldBlockShortcut(input({ code: 'Minus', meta: true }), { isDev: false })).toBe(true)
  })

  it("blocks Chromium's zoom-in (Cmd/Ctrl + Shift + =)", () => {
    expect(
      shouldBlockShortcut(input({ code: 'Equal', control: true, shift: true }), { isDev: false })
    ).toBe(true)
  })

  it('does not block non-keyDown events', () => {
    expect(
      shouldBlockShortcut(input({ type: 'keyUp', code: 'KeyI', control: true, shift: true }), {
        isDev: false
      })
    ).toBe(false)
  })

  it('does not block plain typing', () => {
    expect(shouldBlockShortcut(input({ code: 'KeyA' }), { isDev: false })).toBe(false)
    expect(shouldBlockShortcut(input({ code: 'Enter' }), { isDev: false })).toBe(false)
  })
})
