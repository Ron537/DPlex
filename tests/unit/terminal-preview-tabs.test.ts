/**
 * Unit tests for the preview-tab logic in `terminalStore`. Validates the
 * single-slot-per-group invariant and how `previewTabId` is maintained
 * across openOrFocusDiffTab / promote / close / move operations.
 *
 * Runs in node env. We stub `window.dplex.sessions.saveWorkspace` because
 * a few actions call it via `persistWorkspaceDebounced`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useTerminalStore,
  _serializeWorkspaceForTests
} from '../../src/renderer/src/stores/terminalStore'
import type { ChangedFile } from '../../src/preload'

const FILE_A: ChangedFile = {
  gitPath: 'src/a.ts',
  oldGitPath: null,
  headStatus: 'M',
  wtStatus: '.',
  isConflict: false
} as ChangedFile
const FILE_B: ChangedFile = {
  gitPath: 'src/b.ts',
  oldGitPath: null,
  headStatus: 'M',
  wtStatus: '.',
  isConflict: false
} as ChangedFile
const FILE_C: ChangedFile = {
  gitPath: 'src/c.ts',
  oldGitPath: null,
  headStatus: 'M',
  wtStatus: '.',
  isConflict: false
} as ChangedFile

function setupWindow(): void {
  ;(globalThis as { window?: unknown }).window = {
    dplex: {
      sessions: {
        saveWorkspace: vi.fn().mockResolvedValue(undefined),
        saveWorkspaceSync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined)
      },
      pty: {
        destroy: vi.fn()
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }
}

beforeEach(() => {
  setupWindow()
  // Hard-reset the store between tests. `restoreWorkspace` early-returns
  // when there are existing groups, so we have to drop directly via setState.
  useTerminalStore.setState({
    groups: [],
    layout: { type: 'group', groupId: '' },
    activeGroupId: null,
    restored: false
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function activeGroupId(): string {
  return useTerminalStore.getState().activeGroupId ?? ''
}
function getGroup(id: string): ReturnType<typeof useTerminalStore.getState>['groups'][number] | undefined {
  return useTerminalStore.getState().groups.find((g) => g.id === id)
}

describe('terminalStore.openOrFocusDiffTab — preview semantics', () => {
  beforeEach(() => {
    // Seed a group with a terminal so the panel has a target.
    useTerminalStore.getState().createTerminal()
  })

  it('opens a preview tab the first time and stores it in previewTabId', () => {
    const id = useTerminalStore.getState().openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    const g = getGroup(activeGroupId())!
    expect(g.tabs.find((t) => t.id === id)?.kind).toBe('fileDiff')
    expect(g.previewTabId).toBe(id)
  })

  it('reuses the preview slot when opening another preview', () => {
    const t = useTerminalStore.getState()
    const idA = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    const idB = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_B,
      preview: true
    })
    const g = getGroup(activeGroupId())!
    // Same tab id is reused (preview slot replaced in-place).
    expect(idB).toBe(idA)
    const previews = g.tabs.filter((t) => t.kind === 'fileDiff')
    expect(previews).toHaveLength(1)
    expect((previews[0] as { file: ChangedFile }).file.gitPath).toBe('src/b.ts')
    expect(g.previewTabId).toBe(idB)
  })

  it('focuses an existing permanent tab when re-opening the same path', () => {
    const t = useTerminalStore.getState()
    const idPermanent = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: false
    })
    const idAgain = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    expect(idAgain).toBe(idPermanent)
    const g = getGroup(activeGroupId())!
    // No additional preview tab created.
    expect(g.tabs.filter((t) => t.kind === 'fileDiff')).toHaveLength(1)
  })

  it('promotePreviewTab clears the slot and keeps the tab', () => {
    const t = useTerminalStore.getState()
    const id = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    t.promotePreviewTab(id)
    const g = getGroup(activeGroupId())!
    expect(g.previewTabId).toBeUndefined()
    const tab = g.tabs.find((tt) => tt.id === id)
    expect(tab?.kind).toBe('fileDiff')
    expect((tab as { preview?: boolean }).preview).toBe(false)
  })

  it('closing the preview tab clears previewTabId', () => {
    const t = useTerminalStore.getState()
    const id = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    t.closeTerminal(id)
    const g = getGroup(activeGroupId())
    if (g) expect(g.previewTabId).toBeUndefined()
  })

  it('preview slot survives opening additional permanent tabs', () => {
    const t = useTerminalStore.getState()
    const previewId = t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_C,
      preview: false
    })
    const g = getGroup(activeGroupId())!
    expect(g.previewTabId).toBe(previewId)
    expect(g.tabs.filter((t) => t.kind === 'fileDiff')).toHaveLength(2)
  })
})

describe('terminalStore.serializeWorkspace — preview tabs are not persisted', () => {
  it('drops preview tabs from the serialized payload but keeps permanent ones', () => {
    useTerminalStore.getState().createTerminal()
    const t = useTerminalStore.getState()
    t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_A,
      preview: true
    })
    t.openOrFocusDiffTab({
      repoRootFs: '/r',
      repoLabel: 'r',
      scope: { kind: 'workingTree' },
      file: FILE_C,
      preview: false
    })
    const data = _serializeWorkspaceForTests() as {
      groups: Array<{ tabs: Array<{ kind?: string; file?: ChangedFile }> }>
    }
    const persistedFileTabs = data.groups.flatMap((g) =>
      g.tabs.filter((tt) => tt.kind === 'fileDiff')
    )
    expect(persistedFileTabs).toHaveLength(1)
    expect(persistedFileTabs[0].file!.gitPath).toBe('src/c.ts')
  })
})
