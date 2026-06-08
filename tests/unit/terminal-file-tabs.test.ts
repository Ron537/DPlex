/**
 * Unit tests for the file-editor tab logic in `terminalStore`:
 * preview reuse, dirty-preview protection, double-click promotion, the
 * auto-promote-on-dirty path in `updateFileEditorTab`, and serialization of
 * permanent (but not preview) file editor tabs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useTerminalStore,
  _serializeWorkspaceForTests
} from '../../src/renderer/src/stores/terminalStore'
import { isFileEditorTab } from '../../src/renderer/src/types'

function setupWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined)
      },
      pty: { destroy: vi.fn() }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

beforeEach(() => {
  setupWindow()
  useTerminalStore.setState({
    groups: [],
    layout: { type: 'group', groupId: '' },
    activeGroupId: null,
    restored: false
  } as never)
  useTerminalStore.getState().createTerminal()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function activeGroup(): ReturnType<typeof useTerminalStore.getState>['groups'][number] {
  const s = useTerminalStore.getState()
  return s.groups.find((g) => g.id === s.activeGroupId)!
}

const base = { rootFs: '/proj', rootLabel: 'proj' }

describe('openOrFocusFileTab — preview semantics', () => {
  it('reuses the preview slot for a second single-click', () => {
    const idA = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    const idB = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'b.txt', preview: true })
    expect(idA).toBe(idB)
    const g = activeGroup()
    const fileTabs = g.tabs.filter(isFileEditorTab)
    expect(fileTabs).toHaveLength(1)
    expect(fileTabs[0].relPath).toBe('b.txt')
    expect(g.previewTabId).toBe(idB)
  })

  it('does not replace a dirty preview — opens a separate tab instead', () => {
    const idA = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    useTerminalStore.getState().updateFileEditorTab(idA, { dirty: true })
    const idB = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'b.txt', preview: true })
    expect(idB).not.toBe(idA)
    expect(activeGroup().tabs.filter(isFileEditorTab)).toHaveLength(2)
  })

  it('double-click promotes a matching preview to permanent', () => {
    const id = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    const id2 = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: false })
    expect(id2).toBe(id)
    const g = activeGroup()
    expect(g.previewTabId).toBeUndefined()
    expect(
      g.tabs.find((t) => t.id === id && isFileEditorTab(t) && t.preview === false)
    ).toBeTruthy()
  })

  it('focuses an existing tab for the same path without duplicating', () => {
    const id = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: false })
    const id2 = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    expect(id2).toBe(id)
    expect(activeGroup().tabs.filter(isFileEditorTab)).toHaveLength(1)
  })

  it('single-clicking an already-open file focuses it, not the preview slot', () => {
    // Permanent tab for a.txt, then a separate clean preview slot holding b.txt.
    const permanent = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: false })
    const previewB = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'b.txt', preview: true })
    // Single-click a.txt again: must focus the existing permanent tab rather
    // than overwriting the b.txt preview slot (which would duplicate a.txt).
    const again = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    expect(again).toBe(permanent)
    const g = activeGroup()
    expect(g.tabs.filter(isFileEditorTab)).toHaveLength(2)
    // The preview slot still holds b.txt, untouched.
    expect(g.previewTabId).toBe(previewB)
    const preview = g.tabs.find((t) => t.id === previewB)
    expect(preview && isFileEditorTab(preview) && preview.relPath).toBe('b.txt')
  })

  it('promotePreviewTab clears preview on a file-editor tab (tab-bar double-click)', () => {
    const id = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    expect(activeGroup().previewTabId).toBe(id)
    // Double-clicking the tab itself promotes via promotePreviewTab, which
    // previously only handled fileDiff tabs and left file editors in preview.
    useTerminalStore.getState().promotePreviewTab(id)
    const g = activeGroup()
    expect(g.previewTabId).toBeUndefined()
    expect(
      g.tabs.find((t) => t.id === id && isFileEditorTab(t) && t.preview === false)
    ).toBeTruthy()
  })
})

describe('updateFileEditorTab — auto-promote on dirty', () => {
  it('promotes a preview tab to permanent when it becomes dirty', () => {
    const id = useTerminalStore
      .getState()
      .openOrFocusFileTab({ ...base, relPath: 'a.txt', preview: true })
    expect(activeGroup().previewTabId).toBe(id)
    useTerminalStore.getState().updateFileEditorTab(id, { dirty: true })
    const g = activeGroup()
    expect(g.previewTabId).toBeUndefined()
    const tab = g.tabs.find((t) => t.id === id)
    expect(tab && isFileEditorTab(tab) && tab.preview).toBe(false)
  })
})

describe('serializeWorkspace — file editor tabs', () => {
  it('persists permanent file tabs but not preview tabs', () => {
    useTerminalStore.getState().openOrFocusFileTab({ ...base, relPath: 'keep.txt', preview: false })
    useTerminalStore.getState().openOrFocusFileTab({ ...base, relPath: 'temp.txt', preview: true })
    const snap = _serializeWorkspaceForTests() as {
      groups: { tabs: { kind: string; relPath?: string }[] }[]
    }
    const persisted = snap.groups
      .flatMap((g) => g.tabs)
      .filter((t) => t.kind === 'fileEditor')
      .map((t) => t.relPath)
    expect(persisted).toContain('keep.txt')
    expect(persisted).not.toContain('temp.txt')
  })
})
