import { describe, expect, it } from 'vitest'
import { ALT, isMac, MOD, SHIFT } from '../../src/renderer/src/utils/shortcuts'
import { STATUS_ACTIVE_BG, STATUS_ACTIVE_COLOR } from '../../src/renderer/src/utils/statusColors'
import {
  getTheme,
  getThemeList,
  getThemesByVariant,
  THEMES
} from '../../src/renderer/src/services/themes'

describe('renderer utilities', () => {
  it('uses platform-correct shortcut modifier labels', () => {
    expect(MOD).toBe(isMac ? '⌘' : 'Ctrl+')
    expect(SHIFT).toBe(isMac ? '⇧' : 'Shift+')
    expect(ALT).toBe(isMac ? '⌥' : 'Alt+')
  })

  it('exposes status colors as CSS variables', () => {
    expect(STATUS_ACTIVE_BG).toBe('var(--dplex-status-active-bg)')
    expect(STATUS_ACTIVE_COLOR).toBe('var(--dplex-status-active)')
  })

  it('resolves themes and falls back to default', () => {
    expect(getTheme('does-not-exist')).toBe(THEMES.dplex)

    const themeList = getThemeList()
    expect(themeList.length).toBeGreaterThanOrEqual(5)
    expect(themeList.some((theme) => theme.id === 'dplex')).toBe(true)

    const grouped = getThemesByVariant()
    expect(grouped.dark.length).toBeGreaterThan(0)
    expect(grouped.light.length).toBeGreaterThan(0)
    expect(grouped.dark.every((theme) => theme.variant === 'dark')).toBe(true)
    expect(grouped.light.every((theme) => theme.variant === 'light')).toBe(true)
  })
})
