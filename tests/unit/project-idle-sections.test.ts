import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useProjectStore } from '../../src/renderer/src/stores/projectStore'

// The idle-sessions rollup ("Idle · N resumable") shown inside each expanded
// project / worktree scope is collapsed by default. Its per-scope expansion
// lives in projectStore.expandedIdleSections, where presence == expanded.

beforeEach(() => {
  useProjectStore.setState({ expandedIdleSections: new Set() } as never)
})

afterEach(() => {
  useProjectStore.setState({ expandedIdleSections: new Set() } as never)
})

describe('projectStore idle-section rollup', () => {
  it('defaults to collapsed (scope absent from the set)', () => {
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1')).toBe(false)
  })

  it('toggleIdleSection expands then collapses a scope', () => {
    const { toggleIdleSection } = useProjectStore.getState()
    toggleIdleSection('proj-1')
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1')).toBe(true)
    toggleIdleSection('proj-1')
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1')).toBe(false)
  })

  it('tracks scopes independently (project id vs worktree section id)', () => {
    const { toggleIdleSection } = useProjectStore.getState()
    toggleIdleSection('proj-1')
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1')).toBe(true)
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1::main')).toBe(false)

    toggleIdleSection('proj-1::main')
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1')).toBe(true)
    expect(useProjectStore.getState().expandedIdleSections.has('proj-1::main')).toBe(true)
  })

  it('produces a new Set reference on toggle (immutable update)', () => {
    const before = useProjectStore.getState().expandedIdleSections
    useProjectStore.getState().toggleIdleSection('proj-1')
    const after = useProjectStore.getState().expandedIdleSections
    expect(after).not.toBe(before)
  })
})
