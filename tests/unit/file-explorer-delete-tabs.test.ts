/**
 * Regression coverage for `fileExplorerStore.deletePath` → `syncTabsOnDelete`.
 *
 * Deleting a file auto-closes its CLEAN editor tab, but must NOT close a tab
 * that still holds unsaved work — either a live dirty buffer OR a parked buffer
 * stashed when the editor's Space was backgrounded. Closing the latter would
 * silently drop edits the user never saw a prompt for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTerminalStore } from '../../src/renderer/src/stores/terminalStore'
import { useFileExplorerStore } from '../../src/renderer/src/stores/fileExplorerStore'
import {
  stashParkedEditorBuffer,
  clearParkedEditorBuffer
} from '../../src/renderer/src/services/parkedEditorBuffers'

const ROOT = '/proj'

function setupWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined)
      },
      pty: { destroy: vi.fn() },
      files: {
        delete: vi.fn().mockResolvedValue({ ok: true }),
        listDir: vi.fn().mockResolvedValue({ ok: true, entries: [] })
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

function openCleanEditorTab(relPath: string): string {
  return useTerminalStore
    .getState()
    .openOrFocusFileTab({ rootFs: ROOT, rootLabel: 'proj', relPath, preview: false })
}

function tabExists(id: string): boolean {
  return useTerminalStore.getState().groups.some((g) => g.tabs.some((t) => t.id === id))
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
  useFileExplorerStore.setState({ activeRootFs: ROOT } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deletePath → syncTabsOnDelete', () => {
  it('closes a clean editor tab for the deleted file', async () => {
    const id = openCleanEditorTab('src/a.ts')
    expect(tabExists(id)).toBe(true)
    await useFileExplorerStore.getState().deletePath('src/a.ts')
    expect(tabExists(id)).toBe(false)
  })

  it('keeps a tab holding a parked (backgrounded) buffer open', async () => {
    const id = openCleanEditorTab('src/b.ts')
    // The tab is clean on THIS Space, but its edits live in a parked stash from
    // a backgrounded Space — deleting the file must not drop them.
    stashParkedEditorBuffer(id, {
      content: 'edited',
      eol: '\n',
      baseContent: 'orig',
      baseMtimeMs: 1
    })
    try {
      await useFileExplorerStore.getState().deletePath('src/b.ts')
      expect(tabExists(id)).toBe(true)
    } finally {
      clearParkedEditorBuffer(id)
    }
  })

  it('closes clean descendant tabs when a folder is deleted', async () => {
    const inside = openCleanEditorTab('src/deep/c.ts')
    const outside = openCleanEditorTab('other/d.ts')
    await useFileExplorerStore.getState().deletePath('src')
    expect(tabExists(inside)).toBe(false)
    expect(tabExists(outside)).toBe(true)
  })
})
