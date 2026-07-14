import { afterEach, describe, expect, it } from 'vitest'
import {
  stashParkedEditorBuffer,
  takeParkedEditorBuffer,
  hasParkedEditorBuffer,
  clearParkedEditorBuffer
} from '../../src/renderer/src/services/parkedEditorBuffers'
import {
  registerFileEditor,
  stashAllDirtyFileEditors,
  type FileEditorHandle
} from '../../src/renderer/src/services/fileEditorRegistry'

function fakeHandle(
  dirty: { content: string; eol: '\n' | '\r\n'; baseContent: string; baseMtimeMs: number } | null,
  onFlush?: () => void
): FileEditorHandle {
  return {
    save: async () => {},
    isDirty: () => dirty !== null,
    getDirtyBuffer: () => dirty,
    flushIfAutoSave: () => onFlush?.()
  }
}

describe('parkedEditorBuffers', () => {
  afterEach(() => {
    // Guard against cross-test leakage of the module-level map.
    clearParkedEditorBuffer('t1')
    clearParkedEditorBuffer('t2')
  })

  it('take consumes a stashed buffer exactly once', () => {
    const buf = { content: 'hello', eol: '\n' as const, baseContent: 'hell', baseMtimeMs: 10 }
    stashParkedEditorBuffer('t1', buf)
    expect(takeParkedEditorBuffer('t1')).toEqual(buf)
    // Consumed on first take — a second take returns null.
    expect(takeParkedEditorBuffer('t1')).toBeNull()
  })

  it('take returns null when nothing is stashed', () => {
    expect(takeParkedEditorBuffer('missing')).toBeNull()
  })

  it('clear drops a stashed buffer without returning it (no leak)', () => {
    stashParkedEditorBuffer('t2', { content: 'x', eol: '\r\n', baseContent: '', baseMtimeMs: 1 })
    clearParkedEditorBuffer('t2')
    expect(takeParkedEditorBuffer('t2')).toBeNull()
  })

  it('hasParkedEditorBuffer reports presence without consuming the stash', () => {
    expect(hasParkedEditorBuffer('t1')).toBe(false)
    stashParkedEditorBuffer('t1', { content: 'x', eol: '\n', baseContent: '', baseMtimeMs: 1 })
    expect(hasParkedEditorBuffer('t1')).toBe(true)
    // Non-consuming — repeated checks stay true until an explicit take/clear.
    expect(hasParkedEditorBuffer('t1')).toBe(true)
    expect(takeParkedEditorBuffer('t1')).not.toBeNull()
    expect(hasParkedEditorBuffer('t1')).toBe(false)
  })
})

describe('stashAllDirtyFileEditors', () => {
  it('stashes only dirty editors, restorable on take', () => {
    const dirtyBuf = { content: 'edited', eol: '\n' as const, baseContent: 'orig', baseMtimeMs: 5 }
    const offDirty = registerFileEditor('t1', fakeHandle(dirtyBuf))
    const offClean = registerFileEditor('t2', fakeHandle(null))
    try {
      stashAllDirtyFileEditors()
      // The dirty editor's buffer is preserved for restore-on-remount…
      expect(takeParkedEditorBuffer('t1')).toEqual(dirtyBuf)
      // …while a clean editor stashes nothing.
      expect(takeParkedEditorBuffer('t2')).toBeNull()
    } finally {
      offDirty()
      offClean()
    }
  })

  it('flushes every registered editor on park (onChange autosave lands before quit)', () => {
    const dirtyBuf = { content: 'edited', eol: '\n' as const, baseContent: 'orig', baseMtimeMs: 5 }
    let dirtyFlushes = 0
    let cleanFlushes = 0
    const offDirty = registerFileEditor(
      't1',
      fakeHandle(dirtyBuf, () => (dirtyFlushes += 1))
    )
    const offClean = registerFileEditor(
      't2',
      fakeHandle(null, () => (cleanFlushes += 1))
    )
    try {
      stashAllDirtyFileEditors()
      // Both editors are asked to flush; the handle itself decides whether an
      // onChange save is actually due (dirty + ready + no conflict). Parking must
      // never skip the flush, or a within-debounce edit could be lost on quit.
      expect(dirtyFlushes).toBe(1)
      expect(cleanFlushes).toBe(1)
    } finally {
      offDirty()
      offClean()
    }
  })
})
