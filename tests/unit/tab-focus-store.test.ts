import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import { useTabFocusStore } from '../../src/renderer/src/stores/tabFocusStore'
import type { Project } from '../../src/renderer/src/types'

interface SettingsMock {
  getAll: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
}

let settingsMock: SettingsMock

function installWindow(): void {
  settingsMock = {
    getAll: vi.fn().mockResolvedValue({}),
    merge: vi.fn().mockResolvedValue(undefined)
  }
  ;(globalThis as { window?: unknown }).window = {
    dplex: { settings: settingsMock }
  }
}

function makeProject(id: string, root: string): Project {
  return {
    id,
    name: id,
    path: root,
    addedAt: new Date().toISOString()
  } as Project
}

beforeEach(() => {
  installWindow()
  useProjectStore.setState({ projects: [], activeProjectId: null, loaded: false } as never)
  useTabFocusStore.getState().clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tabFocusStore × project removal', () => {
  it('clears focus when the focused project is removed', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    } as never)
    useTabFocusStore.getState().setFocusedProject('p1')
    expect(useTabFocusStore.getState().focusedProjectId).toBe('p1')

    useProjectStore.getState().removeProject('p1')

    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('leaves focus untouched when a different project is removed', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', '/r1'), makeProject('p2', '/r2')]
    } as never)
    useTabFocusStore.getState().setFocusedProject('p1')

    useProjectStore.getState().removeProject('p2')

    expect(useTabFocusStore.getState().focusedProjectId).toBe('p1')
  })

  it('toggleFocusedProject clears when toggling the currently focused project', () => {
    useTabFocusStore.getState().setFocusedProject('p1')
    useTabFocusStore.getState().toggleFocusedProject('p1')
    expect(useTabFocusStore.getState().focusedProjectId).toBeNull()
  })

  it('toggleFocusedProject switches when toggling a different project', () => {
    useTabFocusStore.getState().setFocusedProject('p1')
    useTabFocusStore.getState().toggleFocusedProject('p2')
    expect(useTabFocusStore.getState().focusedProjectId).toBe('p2')
  })
})
