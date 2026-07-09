import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProjectStore } from '../../src/renderer/src/stores/projectStore'
import type { Project } from '../../src/renderer/src/types'

// `setProjectTabColor` sets a project-wide tab colour (inherited by all of the
// project's tabs) and persists the change via window.dplex.settings.merge.

let merge: ReturnType<typeof vi.fn>

function installWindow(): void {
  merge = vi.fn().mockResolvedValue(undefined)
  ;(globalThis as { window?: unknown }).window = {
    dplex: { settings: { getAll: vi.fn().mockResolvedValue({}), merge } }
  }
}

function makeProject(id: string): Project {
  return { id, name: id, path: `/${id}`, addedAt: new Date().toISOString() } as Project
}

function project(id: string): Project | undefined {
  return useProjectStore.getState().projects.find((p) => p.id === id)
}

beforeEach(() => {
  installWindow()
  useProjectStore.setState({
    projects: [makeProject('p1'), makeProject('p2')],
    loaded: true
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('setProjectTabColor', () => {
  it('sets a colour on the target project only, and persists', () => {
    useProjectStore.getState().setProjectTabColor('p1', '#F87171')
    expect(project('p1')?.tabColor).toBe('#F87171')
    expect(project('p2')?.tabColor).toBeUndefined()
    expect(merge).toHaveBeenCalled()
  })

  it('clears the colour when passed null', () => {
    useProjectStore.getState().setProjectTabColor('p1', '#34D399')
    expect(project('p1')?.tabColor).toBe('#34D399')

    useProjectStore.getState().setProjectTabColor('p1', null)
    expect(project('p1')?.tabColor).toBeUndefined()
  })
})
