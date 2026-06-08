import React, { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { loadMonaco, languageIdForPath } from '../../services/monacoLazy'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { registerFileEditor } from '../../services/fileEditorRegistry'
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
  const disposedRef = useRef(false)

  // Monotonic tokens to invalidate stale async work.
  const loadTokenRef = useRef(0)
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStateRef = useRef<{ inFlight: boolean; queued: boolean }>({
    inFlight: false,
    queued: false
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
    setConflict(false)
    setExternallyChanged(false)
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
            setStatus('missing')
          } else {
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
        setDirty(false)

        if (res.isBinary) setStatus('binary')
        else if (res.truncated) setStatus('too-large')
        else setStatus('ready')

        if (!readOnly) {
          changeListenerRef.current = model.onDidChangeContent(() => {
            if (disposedRef.current) return
            const dirty = isDirtyNow()
            setDirty(dirty)
            if (dirty && autoSaveModeRef.current === 'onChange') {
              clearDebounce()
              debounceTimerRef.current = setTimeout(() => {
                debounceTimerRef.current = null
                // Re-check the mode: the user may have switched to manual save
                // during the debounce window, in which case we must not save.
                if (statusRef.current === 'ready' && autoSaveModeRef.current === 'onChange') {
                  void doSaveRef.current()
                }
              }, AUTO_SAVE_DEBOUNCE_MS)
            }
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
      if (saveStateRef.current.inFlight) {
        saveStateRef.current.queued = true
        return
      }
      saveStateRef.current.inFlight = true
      const curRoot = rootFsRef.current
      const curRel = relPathRef.current
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
          if (disposedRef.current) return
          // A path switch/rename mid-save: abandon (the new target reloads).
          if (rootFsRef.current !== curRoot || relPathRef.current !== curRel) return
          if (!res.ok) {
            if (res.code === 'STALE_FILE') setConflict(true)
            else {
              setStatus('error')
              setErrorMsg(res.message ?? res.code ?? 'Save failed')
            }
            return
          }
          lastSavedContentRef.current = content
          if (typeof res.mtimeMs === 'number') lastSavedMtimeRef.current = res.mtimeMs
          externallyDeletedRef.current = false
          setExternallyDeleted(false)
          setConflict(false)
          setExternallyChanged(false)
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
          if (isDirtyNow()) setExternallyChanged(true)
          else applyExternalReload(res.content, res.eol, res.mtimeMs)
        })
        .catch(() => {})
    }, SAVE_VERIFY_DELAY_MS)
  }

  const applyExternalReload = (content: string, eol: '\n' | '\r\n', mtimeMs: number): void => {
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return
    eolRef.current = eol
    model.setEOL(
      eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF
    )
    if (model.getValue() !== content) model.setValue(content)
    lastSavedContentRef.current = content
    lastSavedMtimeRef.current = mtimeMs
    setDirty(false)
    setExternallyChanged(false)
    setConflict(false)
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
          if (isDirtyNow()) setExternallyChanged(true)
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
      isDirty: () => isDirtyNow()
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
