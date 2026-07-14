import React, { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { loadMonaco, languageIdForPath } from '../../services/monacoLazy'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { registerFileEditor } from '../../services/fileEditorRegistry'
import { takeParkedEditorBuffer, type ParkedEditorBuffer } from '../../services/parkedEditorBuffers'
import { watchRootMatches } from '../../stores/fileWatchRoots'
import { RotateCcw, Save, AlertTriangle } from 'lucide-react'

type EditorStatus = 'loading' | 'ready' | 'binary' | 'too-large' | 'missing' | 'error'

interface MonacoEditorPaneProps {
  tabId: string
  rootFs: string
  relPath: string
  /** True when this tab is the active one in a visible group. */
  isActive: boolean
}

const AUTO_SAVE_DEBOUNCE_MS = 800
/** Delay after a self-write before verifying the on-disk bytes still match. */
const SAVE_VERIFY_DELAY_MS = 1700

function parentRelOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

/**
 * Editable Monaco editor for a single project file. Distinct from the
 * read-only `DiffEditorPane`. Owns the file's lifecycle:
 *  - lazy boot of Monaco, one model per open file;
 *  - dirty tracking (live model comparison, not the async tab flag);
 *  - manual (Cmd/Ctrl+S) and debounced auto-save, serialized so only one
 *    write is ever in flight and the latest buffer always wins;
 *  - self-write protocol: post-save verification + watcher-echo suppression so
 *    our own saves never reload/clobber the buffer, while genuine external
 *    edits reload (when clean) or raise a conflict banner (when dirty);
 *  - optimistic-concurrency conflicts (STALE_FILE) and external delete;
 *  - strict disposal (model-change listener → editor → model, timers cleared,
 *    in-flight loads/saves invalidated, registry + watcher unsubscribed).
 */
export function MonacoEditorPane({
  tabId,
  rootFs,
  relPath,
  isActive
}: MonacoEditorPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const modelRef = useRef<editor.ITextModel | null>(null)
  const changeListenerRef = useRef<{ dispose: () => void } | null>(null)

  const themeName = useSettingsStore((s) => s.settings.theme)
  const autoSaveMode = useSettingsStore((s) => s.settings.editorAutoSave)
  const updateFileEditorTab = useTerminalStore((s) => s.updateFileEditorTab)

  const [status, setStatus] = useState<EditorStatus>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [externallyChanged, setExternallyChanged] = useState(false)
  const [externallyDeleted, setExternallyDeleted] = useState(false)
  const [monacoReady, setMonacoReady] = useState(false)

  // Mutable mirrors so async callbacks read fresh values without re-binding.
  const statusRef = useRef<EditorStatus>('loading')
  const rootFsRef = useRef(rootFs)
  const relPathRef = useRef(relPath)
  const eolRef = useRef<'\n' | '\r\n'>('\n')
  const lastSavedContentRef = useRef<string>('')
  const lastSavedMtimeRef = useRef<number>(0)
  const autoSaveModeRef = useRef(autoSaveMode)
  const externallyDeletedRef = useRef(false)
  const conflictRef = useRef(false)
  const externallyChangedRef = useRef(false)
  const disposedRef = useRef(false)

  // Monotonic tokens to invalidate stale async work.
  const loadTokenRef = useRef(0)
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateRef = useRef<{
    inFlight: boolean
    queued: boolean
    // Captured at park-time when a save is already in-flight: the newest buffer
    // that must still reach disk even though the pane is about to unmount. The
    // in-flight write returns early on dispose and can't loop to pick these
    // keystrokes up, so doSave's finally force-writes this instead.
    parkFlush: { content: string; root: string; rel: string; eol: '\n' | '\r\n' } | null
  }>({
    inFlight: false,
    queued: false,
    parkFlush: null
  })

  // Stable indirection so the registry/command always call the freshest impl.
  const doSaveRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(async () => {})

  useEffect(() => {
    statusRef.current = status
  }, [status])
  useEffect(() => {
    rootFsRef.current = rootFs
  }, [rootFs])
  useEffect(() => {
    relPathRef.current = relPath
  }, [relPath])
  useEffect(() => {
    autoSaveModeRef.current = autoSaveMode
  }, [autoSaveMode])

  // Conflict / external-change flags are mirrored into refs *synchronously* (not
  // via a passive effect) so an async save reads the freshest value: a watcher
  // detecting an external edit and a pending autosave firing can race within the
  // same tick, and a lagging ref would let the autosave overwrite the external
  // change. Always set both through these helpers.
  const markConflict = (v: boolean): void => {
    conflictRef.current = v
    setConflict(v)
  }
  const markExternallyChanged = (v: boolean): void => {
    externallyChangedRef.current = v
    setExternallyChanged(v)
  }

  const isDirtyNow = (): boolean => {
    const m = modelRef.current
    return m ? m.getValue() !== lastSavedContentRef.current : false
  }

  const setDirty = (dirty: boolean): void => {
    updateFileEditorTab(tabId, { dirty })
  }

  const clearDebounce = (): void => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }

  const clearVerify = (): void => {
    if (verifyTimerRef.current) {
      clearTimeout(verifyTimerRef.current)
      verifyTimerRef.current = null
    }
  }

  // Debounced auto-save (onChange mode). Extracted so both the change listener
  // and the park → resume restore path can (re)arm it: parking unmounts the
  // editor, whose cleanup cancels any pending debounce, so a restored dirty
  // buffer must reschedule its save or an autosave editor's stashed edits would
  // never reach disk.
  const scheduleAutoSave = (): void => {
    if (autoSaveModeRef.current !== 'onChange') return
    clearDebounce()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      // Re-check the mode: the user may have switched to manual save during the
      // debounce window, in which case we must not save.
      if (statusRef.current === 'ready' && autoSaveModeRef.current === 'onChange') {
        void doSaveRef.current()
      }
    }, AUTO_SAVE_DEBOUNCE_MS)
  }

  // ---- Boot Monaco once -----------------------------------------------------
  useEffect(() => {
    disposedRef.current = false
    // Per-mount cancellation flag. The shared `disposedRef` is reset to false
    // by the *next* mount's effect body, so under React StrictMode (or any
    // rapid unmount→remount) a still-pending `loadMonaco()` promise from the
    // torn-down mount would see disposedRef===false and create a SECOND editor
    // in the same container — leaving an orphaned, empty editor stacked behind
    // the live one. This local flag is captured per effect run and can't be
    // clobbered by a later mount, so the dead mount's promise is a no-op.
    let cancelled = false
    let booted: editor.IStandaloneCodeEditor | null = null
    loadMonaco()
      .then((monaco) => {
        if (cancelled || disposedRef.current || !containerRef.current) return
        if (editorRef.current) return
        monacoRef.current = monaco
        const isLight = themeName?.toLowerCase().includes('light')
        booted = monaco.editor.create(containerRef.current, {
          value: '',
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: true, renderCharacters: false, showSlider: 'always' },
          fontSize: 12,
          scrollBeyondLastLine: false,
          theme: isLight ? 'vs' : 'vs-dark'
        })
        editorRef.current = booted
        // Cmd/Ctrl+S inside the editor → save (covers the focused case).
        booted.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          void doSaveRef.current()
        })
        booted.addCommand(monaco.KeyCode.F1, () => {})
        setMonacoReady(true)
      })
      .catch((err) => {
        if (cancelled || disposedRef.current) return
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load editor')
      })
    return () => {
      cancelled = true
      disposedRef.current = true
      loadTokenRef.current += 1
      clearDebounce()
      clearVerify()
      changeListenerRef.current?.dispose()
      changeListenerRef.current = null
      booted?.dispose()
      editorRef.current = null
      modelRef.current?.dispose()
      modelRef.current = null
      monacoRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep theme in sync.
  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    const isLight = themeName?.toLowerCase().includes('light')
    monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark')
  }, [themeName, monacoReady])

  /**
   * Restore a parked buffer for a file that was deleted while its Space was
   * parked: mount the unsaved edits as a dirty, externally-deleted editor so
   * they survive and an explicit save recreates the file (mirrors the watcher's
   * dirty-delete handling below). No auto-save fires for a missing file — the
   * user saves deliberately. Declared before the load effect that calls it.
   */
  const restoreDeletedParkedBuffer = (parked: ParkedEditorBuffer): void => {
    const monaco = monacoRef.current
    const ed = editorRef.current
    if (!monaco || !ed) return
    changeListenerRef.current?.dispose()
    changeListenerRef.current = null
    const prevModel = modelRef.current
    const model = monaco.editor.createModel(parked.content, languageIdForPath(relPathRef.current))
    model.setEOL(
      parked.eol === '\r\n'
        ? monaco.editor.EndOfLineSequence.CRLF
        : monaco.editor.EndOfLineSequence.LF
    )
    modelRef.current = model
    ed.setModel(model)
    prevModel?.dispose()
    ed.updateOptions({ readOnly: false })
    eolRef.current = parked.eol
    lastSavedContentRef.current = parked.baseContent
    lastSavedMtimeRef.current = parked.baseMtimeMs
    externallyDeletedRef.current = true
    setExternallyDeleted(true)
    markConflict(false)
    markExternallyChanged(false)
    setStatus('ready')
    setDirty(isDirtyNow())
    changeListenerRef.current = model.onDidChangeContent(() => {
      if (disposedRef.current) return
      setDirty(isDirtyNow())
    })
  }

  // ---- Load (or retarget) on path/mount -------------------------------------
  // A relPath change while the buffer is dirty is a RENAME of the live file
  // (the explorer rewrites the tab's path); we must keep unsaved edits and
  // only retarget language. A clean change is either initial load or an
  // in-place preview replacement → safe to (re)read from disk.
  useEffect(() => {
    if (!monacoReady) return
    const monaco = monacoRef.current
    const ed = editorRef.current
    if (!monaco || !ed) return

    if (modelRef.current && isDirtyNow()) {
      const lang = languageIdForPath(relPath)
      if (modelRef.current.getLanguageId() !== lang) {
        monaco.editor.setModelLanguage(modelRef.current, lang)
      }
      return
    }

    const token = ++loadTokenRef.current
    setStatus('loading')
    setErrorMsg(null)
    markConflict(false)
    markExternallyChanged(false)
    setExternallyDeleted(false)
    externallyDeletedRef.current = false
    clearDebounce()
    clearVerify()

    window.dplex.files
      .readFile(rootFs, relPath)
      .then((res) => {
        if (disposedRef.current || token !== loadTokenRef.current) return
        const monaco2 = monacoRef.current
        const ed2 = editorRef.current
        if (!monaco2 || !ed2) return

        if (!res.ok) {
          if (res.code === 'NOT_FOUND') {
            // The file was deleted while its Space was parked. If we stashed
            // unsaved edits, restore them as a dirty, externally-deleted buffer
            // (an explicit save recreates the file) rather than dropping them.
            // Consuming the stash here also stops it leaking.
            const parked = takeParkedEditorBuffer(tabId)
            if (parked) restoreDeletedParkedBuffer(parked)
            else setStatus('missing')
          } else {
            // Leave any stash in place — a later successful remount recovers it.
            setStatus('error')
            setErrorMsg(res.message ?? res.code ?? 'Failed to read file')
          }
          return
        }

        const readOnly = res.isBinary || res.truncated
        eolRef.current = res.eol
        lastSavedContentRef.current = res.content
        lastSavedMtimeRef.current = res.mtimeMs

        const lang = languageIdForPath(relPath)
        // Detach + dispose any prior model before creating the new one.
        changeListenerRef.current?.dispose()
        changeListenerRef.current = null
        const prevModel = modelRef.current
        const model = monaco2.editor.createModel(res.content, lang)
        model.setEOL(
          res.eol === '\r\n'
            ? monaco2.editor.EndOfLineSequence.CRLF
            : monaco2.editor.EndOfLineSequence.LF
        )
        modelRef.current = model
        ed2.setModel(model)
        prevModel?.dispose()
        ed2.updateOptions({ readOnly })

        // Restore an unsaved buffer stashed when this editor's Space was parked
        // (switched away / minimized). Only for editable files — a file that
        // turned binary/too-large while parked can't host the edits, so we leave
        // its stash in place (rather than consuming and dropping it): the close
        // guard still treats the tab as dirty, and it self-heals if the file
        // becomes editable again. Runs before the change listener attaches
        // below, so restoring doesn't spuriously trigger onChange auto-save.
        const parked = readOnly ? null : takeParkedEditorBuffer(tabId)
        if (parked) {
          model.setValue(parked.content)
          model.setEOL(
            parked.eol === '\r\n'
              ? monaco2.editor.EndOfLineSequence.CRLF
              : monaco2.editor.EndOfLineSequence.LF
          )
          if (res.content === parked.content) {
            // Disk already holds exactly our parked edit — an onChange editor
            // flushed the pending autosave when its Space was parked (or an
            // external write happened to land identical bytes). Adopt disk as the
            // clean baseline: nothing to save, and crucially no false conflict.
            lastSavedContentRef.current = res.content
            lastSavedMtimeRef.current = res.mtimeMs
            setDirty(false)
          } else {
            // Reinstate the baseline the edits were made against (keeping the OLD
            // mtime) so a concurrent external write during the park window is
            // surfaced as a conflict on save instead of being silently
            // overwritten — the same protection a mounted dirty editor has.
            lastSavedContentRef.current = parked.baseContent
            lastSavedMtimeRef.current = parked.baseMtimeMs
            // Disk diverged from our edit baseline while parked → a hard conflict:
            // block autosave from overwriting the external change (the user must
            // Reload or explicitly Overwrite). The mtime tolerance alone can miss
            // a near-simultaneous external write, so don't rely on STALE here.
            if (res.content !== parked.baseContent) markConflict(true)
            setDirty(isDirtyNow())
            // Parking unmounted the editor and cancelled any pending auto-save. If
            // the disk still matches the edit baseline (no conflict), re-arm the
            // autosave so a stashed onChange edit still reaches disk even if the
            // park-time flush hadn't landed yet; a diverged disk raised a conflict
            // above, which blocks writes until resolved.
            if (res.content === parked.baseContent && isDirtyNow()) scheduleAutoSave()
          }
        } else {
          setDirty(false)
        }

        if (res.isBinary) setStatus('binary')
        else if (res.truncated) setStatus('too-large')
        else setStatus('ready')

        if (!readOnly) {
          changeListenerRef.current = model.onDidChangeContent(() => {
            if (disposedRef.current) return
            const dirty = isDirtyNow()
            setDirty(dirty)
            if (dirty) scheduleAutoSave()
          })
        }

        // Force a layout pass for the freshly-attached model.
        requestAnimationFrame(() => {
          try {
            ed2.layout()
          } catch {
            /* disposed */
          }
        })
      })
      .catch((err) => {
        if (disposedRef.current || token !== loadTokenRef.current) return
        setStatus('error')
        setErrorMsg(err instanceof Error ? err.message : 'Failed to read file')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFs, relPath, monacoReady])

  // Re-layout when this tab becomes active (hidden Monaco can measure 0×0).
  useEffect(() => {
    if (!isActive) return
    const ed = editorRef.current
    if (!ed) return
    requestAnimationFrame(() => {
      try {
        ed.layout()
      } catch {
        /* disposed */
      }
    })
  }, [isActive])

  // ---- Save (serialized) ----------------------------------------------------
  // Reassigned after every render via an effect (not during render) so the
  // registry/command indirection always calls the freshest closure while
  // staying lint-clean about ref access during render.
  useEffect(() => {
    doSaveRef.current = async (opts?: { force?: boolean }): Promise<void> => {
      const model = modelRef.current
      if (!model || disposedRef.current) return
      // Only saveable when ready, OR when the file was externally deleted while
      // dirty (save recreates it). Binary/too-large/loading are never saved.
      if (statusRef.current !== 'ready' && !externallyDeletedRef.current) return
      // A known external change (hard conflict, or the softer watcher/verify
      // "changed on disk" state) must never be silently overwritten by an
      // autosave or ⌘S — only an explicit force (the banner's Overwrite / Keep
      // mine) or a deleted-file recreate may write through it. Guarding on the
      // watcher state too closes the mtime-tolerance hole where a near-
      // simultaneous external edit slips past the optimistic-concurrency check.
      if (
        (conflictRef.current || externallyChangedRef.current) &&
        !(opts?.force || externallyDeletedRef.current)
      )
        return
      if (saveStateRef.current.inFlight) {
        saveStateRef.current.queued = true
        return
      }
      saveStateRef.current.inFlight = true
      const curRoot = rootFsRef.current
      const curRel = relPathRef.current
      // Our own last successful write's mtime this call, captured before the
      // dispose bail-out (which skips the ref update below) so the park-flush can
      // guard against a racing external edit instead of blind-forcing.
      let lastOkMtimeMs: number | undefined
      try {
        // Loop so edits made mid-write are flushed (latest buffer always wins).
        // Converges once the model is unchanged across a completed write.

        while (true) {
          const m = modelRef.current
          if (!m || disposedRef.current) return
          const content = m.getValue()
          const versionId = m.getAlternativeVersionId()
          const force = opts?.force || externallyDeletedRef.current
          const expected = force ? undefined : lastSavedMtimeRef.current
          const res = await window.dplex.files.writeFile(
            curRoot,
            curRel,
            content,
            eolRef.current,
            expected
          )
          // A path switch/rename mid-save: abandon (the new target reloads).
          // Checked before recording conflict so a stale write against the OLD
          // target never flags the pane's NEW file.
          if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
          // Record a stale write synchronously — even if this pane has since been
          // disposed (parked/unmounted) — so the park-flush in `finally` observes
          // the conflict and never force-overwrites an external edit that landed
          // during this in-flight write.
          if (!res.ok && res.code === 'STALE_FILE') markConflict(true)
          if (res.ok && typeof res.mtimeMs === 'number') lastOkMtimeMs = res.mtimeMs
          if (disposedRef.current) return
          if (!res.ok) {
            if (res.code !== 'STALE_FILE') {
              setStatus('error')
              setErrorMsg(res.message ?? res.code ?? 'Save failed')
            }
            return
          }
          lastSavedContentRef.current = content
          if (typeof res.mtimeMs === 'number') lastSavedMtimeRef.current = res.mtimeMs
          externallyDeletedRef.current = false
          setExternallyDeleted(false)
          markConflict(false)
          markExternallyChanged(false)
          scheduleVerify(content)
          const stillSame =
            modelRef.current && modelRef.current.getAlternativeVersionId() === versionId
          if (stillSame) {
            setDirty(false)
            break
          }
          // Model changed during the write → loop and save the newer buffer.
        }
      } finally {
        saveStateRef.current.inFlight = false
        const parkFlush = saveStateRef.current.parkFlush
        saveStateRef.current.parkFlush = null
        // The pane parked mid-write: write the captured final keystrokes to disk
        // so they survive the unmount. Only when actually disposed — otherwise the
        // loop above already re-wrote the newest content and this stale capture
        // would regress the file. Guarded (below) by our own last successful
        // write's mtime rather than forced: if an external edit raced in after
        // that write, this fails STALE and is dropped instead of clobbering it.
        // Also skipped on a known conflict/external change. Either way the dirty
        // buffer was stashed to parkedEditorBuffers on park
        // (stashAllDirtyFileEditors), so nothing is lost — it's reconciled on resume.
        if (
          parkFlush &&
          disposedRef.current &&
          !conflictRef.current &&
          !externallyChangedRef.current
        ) {
          void window.dplex.files.writeFile(
            parkFlush.root,
            parkFlush.rel,
            parkFlush.content,
            parkFlush.eol,
            lastOkMtimeMs
          )
        }
        if (saveStateRef.current.queued && !disposedRef.current) {
          saveStateRef.current.queued = false
          void doSaveRef.current()
        }
      }
    }
  })

  // After a self-write, verify on-disk bytes once the watcher-suppression
  // window has passed. Catches an external edit landing inside that window
  // (which the watcher would otherwise swallow as our own echo).
  const scheduleVerify = (savedContent: string): void => {
    clearVerify()
    const curRoot = rootFsRef.current
    const curRel = relPathRef.current
    verifyTimerRef.current = setTimeout(() => {
      verifyTimerRef.current = null
      if (disposedRef.current) return
      if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
      window.dplex.files
        .readFile(curRoot, curRel)
        .then((res) => {
          if (disposedRef.current || !res.ok) return
          if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
          if (res.content === savedContent) {
            lastSavedMtimeRef.current = res.mtimeMs
            return
          }
          // Disk diverged from what we wrote → genuine external edit.
          if (isDirtyNow()) markExternallyChanged(true)
          else applyExternalReload(res.content, res.eol, res.mtimeMs)
        })
        .catch(() => {})
    }, SAVE_VERIFY_DELAY_MS)
  }

  const applyExternalReload = (content: string, eol: '\n' | '\r\n', mtimeMs: number): void => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return
    // Update the saved baseline BEFORE mutating the model: setValue/setEOL fire
    // the synchronous onDidChangeContent listener, which reads these refs via
    // isDirtyNow — a stale baseline would flag the reload as dirty and schedule
    // a redundant (identical-bytes) autosave. Apply the new content BEFORE the
    // EOL: setEOL also fires the change listener, and doing it while the model
    // still holds the OLD content (but the baseline is already the NEW content)
    // would read as dirty and arm a spurious autosave when both content and EOL
    // changed. With the value applied first, every change event sees content
    // that matches the baseline.
    eolRef.current = eol
    lastSavedContentRef.current = content
    lastSavedMtimeRef.current = mtimeMs
    if (model.getValue() !== content) model.setValue(content)
    model.setEOL(
      eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
    )
    setDirty(false)
    markExternallyChanged(false)
    markConflict(false)
  }

  // ---- External change detection (watcher) ----------------------------------
  useEffect(() => {
    const off = window.dplex.files.onTreeChanged((p) => {
      if (disposedRef.current) return
      if (!watchRootMatches(p.rootFs, rootFsRef.current)) return
      const parent = parentRelOf(relPathRef.current)
      if (!p.dirs.includes(parent)) return
      if (statusRef.current === 'loading') return
      const curRoot = rootFsRef.current
      const curRel = relPathRef.current
      window.dplex.files
        .readFile(curRoot, curRel)
        .then((res) => {
          if (disposedRef.current) return
          if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
          if (!res.ok) {
            if (res.code === 'NOT_FOUND') {
              if (isDirtyNow()) {
                externallyDeletedRef.current = true
                setExternallyDeleted(true)
              } else {
                setStatus('missing')
              }
            }
            return
          }
          // Recovered from a deleted/missing state.
          if (statusRef.current === 'missing') {
            applyExternalReload(res.content, res.eol, res.mtimeMs)
            setStatus(res.isBinary ? 'binary' : res.truncated ? 'too-large' : 'ready')
            return
          }
          if (res.content === lastSavedContentRef.current) {
            lastSavedMtimeRef.current = res.mtimeMs
            return
          }
          if (isDirtyNow()) markExternallyChanged(true)
          else applyExternalReload(res.content, res.eol, res.mtimeMs)
        })
        .catch(() => {})
    })
    return () => off()
    // Mount-only: reads live refs; deps would re-subscribe the watcher needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Registry: expose save/isDirty for the active-tab Cmd+S + header -------
  useEffect(() => {
    const unregister = registerFileEditor(tabId, {
      save: () => doSaveRef.current(),
      isDirty: () => isDirtyNow(),
      getDirtyBuffer: () =>
        isDirtyNow() && modelRef.current
          ? {
              content: modelRef.current.getValue(),
              eol: eolRef.current,
              baseContent: lastSavedContentRef.current,
              baseMtimeMs: lastSavedMtimeRef.current
            }
          : null,
      // Called when this editor's Space is being parked (switch away / minimize).
      // In onChange auto-save mode, dispatch the pending debounced save NOW —
      // while the model is still mounted — so an edit made inside the debounce
      // window reaches disk before the pane unmounts. Without this, quitting
      // while parked (before the editor remounts and re-arms the timer on resume)
      // would drop that edit. A known conflict / external change is deliberately
      // left untouched for the user to resolve on resume; manual-save mode never
      // auto-flushes. doSave captures content synchronously before its await, so
      // this fire-and-forget dispatch reaches disk even though we unmount next.
      flushIfAutoSave: () => {
        const model = modelRef.current
        if (
          autoSaveModeRef.current === 'onChange' &&
          statusRef.current === 'ready' &&
          !conflictRef.current &&
          !externallyChangedRef.current &&
          !externallyDeletedRef.current &&
          model &&
          isDirtyNow()
        ) {
          if (saveStateRef.current.inFlight) {
            // A save is mid-write and we're about to unmount: that write can't
            // loop to pick up the newest keystrokes once disposed. Capture them
            // now (model still mounted) so doSave's finally forces them to disk.
            saveStateRef.current.parkFlush = {
              content: model.getValue(),
              root: rootFsRef.current,
              rel: relPathRef.current,
              eol: eolRef.current
            }
          } else {
            void doSaveRef.current()
          }
        }
      }
    })
    return unregister
  }, [tabId])

  const reloadFromDisk = (): void => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return
    const curRoot = rootFsRef.current
    const curRel = relPathRef.current
    window.dplex.files
      .readFile(curRoot, curRel)
      .then((res) => {
        if (disposedRef.current || !res.ok) return
        if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
        applyExternalReload(res.content, res.eol, res.mtimeMs)
      })
      .catch(() => {})
  }

  // ---- Render ---------------------------------------------------------------
  const showOverlayNotice =
    status === 'binary' || status === 'too-large' || status === 'missing' || status === 'error'

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: 'var(--dplex-bg)' }}>
      <div ref={containerRef} className="w-full h-full" />

      {(conflict || externallyChanged || externallyDeleted) && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 py-1.5 text-[12px] z-20"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            borderBottom: '1px solid var(--dplex-status-warning, #fbbf24)',
            color: 'var(--dplex-text)'
          }}
        >
          <AlertTriangle size={14} style={{ color: 'var(--dplex-status-warning, #fbbf24)' }} />
          <span className="flex-1 min-w-0 truncate">
            {externallyDeleted
              ? 'File was deleted on disk. Save to recreate it.'
              : conflict
                ? 'File changed on disk since you opened it.'
                : 'File changed on disk. Reload to get the latest, or keep your edits.'}
          </span>
          {!externallyDeleted && (
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--dplex-hover)]"
              onClick={reloadFromDisk}
              title="Discard your changes and reload from disk"
            >
              <RotateCcw size={12} /> Reload
            </button>
          )}
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--dplex-hover)]"
            onClick={() => void doSaveRef.current({ force: true })}
            title="Overwrite the file on disk with your changes"
          >
            <Save size={12} /> {conflict ? 'Overwrite' : externallyDeleted ? 'Save' : 'Keep mine'}
          </button>
        </div>
      )}

      {showOverlayNotice && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm px-4 text-center pointer-events-none"
          style={{ color: 'var(--dplex-text-muted)', backgroundColor: 'var(--dplex-bg)' }}
        >
          {status === 'binary'
            ? 'Binary file — not shown'
            : status === 'too-large'
              ? 'File is too large to edit (> 2 MB)'
              : status === 'missing'
                ? 'File no longer exists on disk.'
                : (errorMsg ?? 'Failed to open file')}
        </div>
      )}
    </div>
  )
}
