/**
 * Verifies that `loadSettings` applies the `editorAutoSave` default when a
 * persisted settings blob predates the field, and preserves a stored value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../src/renderer/src/stores/settingsStore'

function setupWindow(getAll: () => Promise<unknown>): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      settings: {
        getAll: vi.fn(getAll),
        merge: vi.fn().mockResolvedValue(undefined)
      }
    }
  }
}

beforeEach(() => {
  useSettingsStore.setState({ loaded: false } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('settingsStore — editorAutoSave merge', () => {
  it('defaults editorAutoSave to "manual" when absent from saved settings', async () => {
    setupWindow(async () => ({ theme: 'dplex-dark' }))
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().settings.editorAutoSave).toBe('manual')
  })

  it('preserves a persisted editorAutoSave value', async () => {
    setupWindow(async () => ({ editorAutoSave: 'onChange' }))
    await useSettingsStore.getState().loadSettings()
    expect(useSettingsStore.getState().settings.editorAutoSave).toBe('onChange')
  })
})
