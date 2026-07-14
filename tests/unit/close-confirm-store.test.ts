import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCloseConfirmStore } from '../../src/renderer/src/stores/closeConfirmStore'
import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import { registerFileEditor } from '../../src/renderer/src/services/fileEditorRegistry'
import {
  stashParkedEditorBuffer,
  clearParkedEditorBuffer
} from '../../src/renderer/src/services/parkedEditorBuffers'
import type { EditorGroup, FileEditorTab, TerminalTab } from '../../src/renderer/src/types'

const closeTerminal = vi.fn()

function fileEditorTab(id: string, dirty = false): FileEditorTab {
  return {
    id,
    title: id,
    kind: 'fileEditor',
    rootFs: '/r',
    rootLabel: 'r',
    relPath: 'a.ts',
    preview: false,
    dirty
  }
}

function terminalTab(id: string): TerminalTab {
  return { id, title: id, cwd: '/r', command: 'copilot', sessionId: id, providerId: 'copilot-cli' }
}

function setTabs(tabs: EditorGroup['tabs']): void {
  useTerminalStore.setState({
    groups: [{ id: 'g', tabs, activeTabId: tabs[0]?.id ?? '' }],
    layout: { type: 'group', groupId: 'g' },
    activeGroupId: 'g',
    // Override the real teardown so tests observe intent without running IPC.
    closeTerminal
  } as never)
}

beforeEach(() => {
  closeTerminal.mockReset()
  useCloseConfirmStore.setState({ pendingTabId: null, pendingTitle: '' })
})

afterEach(() => {
  clearParkedEditorBuffer('f1')
  vi.restoreAllMocks()
})

describe('closeConfirmStore.request', () => {
  it('closes a clean, unmounted file editor immediately (no prompt)', () => {
    setTabs([fileEditorTab('f1', false)])
    useCloseConfirmStore.getState().request('f1')
    expect(closeTerminal).toHaveBeenCalledWith('f1')
    expect(useCloseConfirmStore.getState().pendingTabId).toBeNull()
  })

  it('prompts for a mounted dirty editor (live handle reports dirty)', () => {
    setTabs([fileEditorTab('f1', false)])
    // A live handle overrides the persisted flag.
    const unregister = registerFileEditor('f1', {
      save: async () => {},
      isDirty: () => true,
      getDirtyBuffer: () => null
    })
    useCloseConfirmStore.getState().request('f1')
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(useCloseConfirmStore.getState().pendingTabId).toBe('f1')
    unregister()
  })

  it('prompts for an UNMOUNTED editor that still holds a parked unsaved buffer', () => {
    // No live handle (the tab was unmounted when its Space was backgrounded) and
    // the persisted dirty flag is false — but a stashed buffer means unsaved
    // edits exist, so closing must prompt instead of silently discarding them.
    setTabs([fileEditorTab('f1', false)])
    stashParkedEditorBuffer('f1', {
      content: 'edited',
      eol: '\n',
      baseContent: 'x',
      baseMtimeMs: 1
    })
    useCloseConfirmStore.getState().request('f1')
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(useCloseConfirmStore.getState().pendingTabId).toBe('f1')
  })

  it('prompts for a MOUNTED editor reporting clean that still holds a parked buffer', () => {
    // Regression: a mounted handle can report clean while a stash survives — e.g.
    // the file turned binary/too-large while parked (loads read-only, can't host
    // the edits) or is still loading. A false handle.isDirty() must NOT mask the
    // stash, or the backgrounded edits would close without a prompt.
    setTabs([fileEditorTab('f1', false)])
    const unregister = registerFileEditor('f1', {
      save: async () => {},
      isDirty: () => false,
      getDirtyBuffer: () => null
    })
    stashParkedEditorBuffer('f1', {
      content: 'edited',
      eol: '\n',
      baseContent: 'x',
      baseMtimeMs: 1
    })
    useCloseConfirmStore.getState().request('f1')
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(useCloseConfirmStore.getState().pendingTabId).toBe('f1')
    unregister()
  })

  it('closes a non-editor tab immediately regardless of parked buffers', () => {
    setTabs([terminalTab('f1')])
    // Even a stray stash for this id must not gate a non-editor close.
    stashParkedEditorBuffer('f1', { content: 'x', eol: '\n', baseContent: '', baseMtimeMs: 1 })
    useCloseConfirmStore.getState().request('f1')
    expect(closeTerminal).toHaveBeenCalledWith('f1')
    expect(useCloseConfirmStore.getState().pendingTabId).toBeNull()
  })
})
