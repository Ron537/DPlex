import React, { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { ChangedFile, FileDiffContent } from '../../../../preload'
import type { DiffScopePersisted } from '../../types'
import { loadMonaco, languageIdForPath } from '../../services/monacoLazy'
import { useSettingsStore } from '../../stores/settingsStore'

interface DiffEditorPaneProps {
  repoRootFs: string
  scope: DiffScopePersisted
  file: ChangedFile | null
  sideBySide: boolean
  /** Bumped to force a re-fetch (e.g. external watcher events). */
  refreshKey: number
}

function disposeAttachedModels(ed: editor.IStandaloneDiffEditor | null): void {
  const prev = ed?.getModel()
  prev?.original?.dispose()
  prev?.modified?.dispose()
}

/**
 * Wraps Monaco's `DiffEditor`. Lazy-loads Monaco on first mount.
 *
 * Renders `HEAD ↔ index` for staged-only files (wtStatus === '.') and
 * `index ↔ working tree` otherwise, in working-tree scope.
 */
export function DiffEditorPane({
  repoRootFs,
  scope,
  file,
  sideBySide,
  refreshKey
}: DiffEditorPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const [monacoReady, setMonacoReady] = useState(false)
  const [content, setContent] = useState<FileDiffContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  // Local toggle for partially-staged files (XY where both sides differ
  // from `.`). Reset when the selected file changes.
  const [stagedView, setStagedView] = useState<boolean>(false)
  const themeName = useSettingsStore((s) => s.settings.theme)
  // Monotonic token for the latest fileContent request — older requests
  // resolving after a newer one are dropped to avoid stale overwrites.
  const fetchTokenRef = useRef(0)
  // sideBySide value at boot may be stale by the time loadMonaco resolves
  // (user could toggle while Monaco is downloading). Re-read via ref so the
  // boot effect commits the freshest layout.
  const sideBySideRef = useRef(sideBySide)
  useEffect(() => {
    sideBySideRef.current = sideBySide
  }, [sideBySide])
  // gitPath of the currently-attached models. Used by the fetch effect to
  // decide whether the next fetch is a "file switch" (must clear stale
  // content) vs a "refresh of the same file" (keep old content visible
  // until new content arrives — eliminates flicker). Used by the apply
  // effect to decide whether to reuse models via setValue (same file) or
  // dispose+recreate (different file).
  const attachedGitPathRef = useRef<string | null>(null)

  // Boot Monaco + create editor instance once.
  useEffect(() => {
    let disposed = false
    let editorInstance: editor.IStandaloneDiffEditor | null = null
    loadMonaco()
      .then((monaco) => {
        if (disposed || !containerRef.current) return
        try {
          monacoRef.current = monaco
          editorInstance = monaco.editor.createDiffEditor(containerRef.current, {
            renderSideBySide: sideBySideRef.current,
            readOnly: true,
            originalEditable: false,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 12,
            renderOverviewRuler: false,
            scrollBeyondLastLine: false
          })
          editorRef.current = editorInstance
          setMonacoReady(true)
        } catch (err) {
          console.error('[DiffEditorPane] Monaco editor creation failed', err)
          setError(err instanceof Error ? err.message : 'Editor creation failed')
        }
      })
      .catch((err) => {
        console.error('[DiffEditorPane] Monaco load failed', err)
        if (!disposed) setError(err instanceof Error ? err.message : 'Failed to load editor')
      })
    return () => {
      disposed = true
      // Dispose models BEFORE the editor — Monaco's IDiffEditor.dispose()
      // does NOT dispose its attached models (they're considered shared
      // resources owned by the consumer).
      disposeAttachedModels(editorInstance)
      editorInstance?.dispose()
      editorRef.current = null
      monacoRef.current = null
    }
    // intentionally only on mount — sideBySide handled separately to avoid recreating the editor
  }, [])

  // sideBySide is also baked into createDiffEditor at boot via sideBySideRef.
  // The actual visual switch happens via a React-level remount triggered by
  // a `key` prop in DiffTabView (Monaco's in-place updateOptions for
  // renderSideBySide is unreliable). updateOptions is kept as a no-op
  // safety net in case the key is ever removed.
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    const isLight = themeName?.toLowerCase().includes('light')
    monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark')
  }, [themeName, monacoReady])

  // Compute partial-staged flag (both staged and unstaged changes exist).
  // Excludes pure-staged (wt='.'), pure-unstaged (head='.'), conflicts,
  // untracked ('?'), and the unhandled head='?' shape.
  const isPartialStaged =
    !!file &&
    scope.kind === 'workingTree' &&
    !file.isConflict &&
    file.headStatus !== '.' &&
    file.headStatus !== '?' &&
    file.wtStatus !== '.' &&
    file.wtStatus !== '?'

  // Reset stagedView when the selected file changes.
  useEffect(() => {
    setStagedView(false)
  }, [file?.gitPath])

  // Fetch effect: bumps fetchToken to invalidate older in-flight requests.
  useEffect(() => {
    if (!file) {
      setContent(null)
      setError(null)
      setLoading(false)
      const ed = editorRef.current
      const monaco = monacoRef.current
      if (monaco && ed) {
        const empty1 = monaco.editor.createModel('', 'plaintext')
        const empty2 = monaco.editor.createModel('', 'plaintext')
        const prev = ed.getModel()
        ed.setModel({ original: empty1, modified: empty2 })
        prev?.original?.dispose()
        prev?.modified?.dispose()
        attachedGitPathRef.current = null
      }
      return
    }
    fetchTokenRef.current += 1
    const myToken = fetchTokenRef.current
    // (B) Only clear stale content on FILE SWITCH. On a refreshKey-only
    // bump (same file, watcher fired), keep the old content visible until
    // the new fetch resolves — this eliminates the empty-content flash.
    // The apply effect's setValue() path (A) takes over from there.
    const isFileSwitch = attachedGitPathRef.current !== file.gitPath
    if (isFileSwitch) {
      setContent(null)
    }
    // (D) Only show the loading badge on initial load or file switch.
    // Background watcher refreshes that already have content displayed
    // shouldn't blink the badge — it's the most visible flicker source.
    if (isFileSwitch || !content) {
      setLoading(true)
    }
    setError(null)
    // Working-tree scope: pick `staged` based on which side has changes.
    // - wtStatus === '.': all changes are HEAD↔index (staged-only) — request that pair.
    // - partial-staged (MM-like): respect the local stagedView toggle.
    // - otherwise: request index↔working-tree (covers M, untracked).
    const stagedSide =
      scope.kind === 'workingTree' &&
      (isPartialStaged ? stagedView : file.wtStatus === '.' && file.headStatus !== '.')
    window.dplex.diff
      .fileContent({
        repoRootFs,
        scope,
        file,
        staged: stagedSide
      })
      .then((c) => {
        if (myToken !== fetchTokenRef.current) return
        setContent(c)
      })
      .catch((err) => {
        if (myToken !== fetchTokenRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load diff content')
      })
      .finally(() => {
        if (myToken === fetchTokenRef.current) setLoading(false)
      })
    return () => {
      // Mark ANY in-flight request stale on unmount or dep change.
      fetchTokenRef.current += 1
    }
    // `content` intentionally excluded: it's only read inside the (D)
    // loading-badge gate; including it would re-run the fetch on every
    // content arrival and cause an infinite refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, repoRootFs, scope, refreshKey, stagedView, isPartialStaged])

  // Apply effect: attach models when both Monaco AND content are ready.
  // Splitting this from the fetch effect ensures content fetched before
  // Monaco finished loading is still rendered once Monaco becomes available.
  //
  // (A) When the same file is re-fetched (watcher refresh), reuse the
  // existing models via setValue() instead of dispose+recreate. Monaco's
  // diff worker incrementally diffs the new text against the old one,
  // preserves scroll/cursor/selection, and crucially does NOT flash
  // empty content. Only file-switch paths (different gitPath) take the
  // dispose+recreate route.
  //
  // (C) Skip the work entirely when fetched text is byte-identical to
  // what's already attached — the watcher fires for unrelated paths
  // (lockfiles, build artifacts) far more often than for the selected
  // file's bytes actually changing.
  useEffect(() => {
    if (!monacoReady || !content || !file) return
    const monaco = monacoRef.current
    const ed = editorRef.current
    if (!monaco || !ed) return
    try {
      const lang = languageIdForPath(file.gitPath)
      const leftText = content.leftIsEmpty ? '' : (content.leftText ?? '')
      const rightText = content.rightIsEmpty ? '' : (content.rightText ?? '')
      const prev = ed.getModel()
      const sameFile =
        attachedGitPathRef.current === file.gitPath &&
        prev?.original != null &&
        prev?.modified != null
      if (sameFile && prev) {
        // (C) Byte-identical → no-op. Avoids any visual churn.
        const oldLeft = prev.original.getValue()
        const oldRight = prev.modified.getValue()
        if (oldLeft === leftText && oldRight === rightText) {
          return
        }
        // (A) Same file, different bytes → setValue keeps scroll/cursor.
        if (oldLeft !== leftText) prev.original.setValue(leftText)
        if (oldRight !== rightText) prev.modified.setValue(rightText)
        // Re-apply language in case it changed (rare: file rename within
        // the same gitPath shouldn't happen, but keep models consistent).
        if (prev.original.getLanguageId() !== lang) {
          monaco.editor.setModelLanguage(prev.original, lang)
        }
        if (prev.modified.getLanguageId() !== lang) {
          monaco.editor.setModelLanguage(prev.modified, lang)
        }
        return
      }
      // File switch (or first attach for this file): dispose+recreate.
      const left = monaco.editor.createModel(leftText, lang)
      const right = monaco.editor.createModel(rightText, lang)
      ed.setModel({ original: left, modified: right })
      prev?.original?.dispose()
      prev?.modified?.dispose()
      attachedGitPathRef.current = file.gitPath
      // Force layout repeatedly — when Monaco is created in a flex
      // container that hasn't sized yet, automaticLayout's ResizeObserver
      // can miss the first layout pass and the editor stays at 0×0.
      const forceLayout = (): void => {
        try {
          ed.layout()
        } catch {
          /* editor disposed */
        }
      }
      requestAnimationFrame(forceLayout)
      const t = setTimeout(forceLayout, 50)
      return () => clearTimeout(t)
    } catch (err) {
      console.error('[DiffEditorPane] Failed to attach diff models', err)
      setError(err instanceof Error ? err.message : 'Failed to render diff')
      return undefined
    }
  }, [content, monacoReady, file])

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: 'var(--dplex-bg)' }}>
      {/* Monaco's container is ALWAYS mounted so the ref attaches on first
          render. Otherwise the boot effect's loadMonaco().then() runs while
          the container is still gated behind an early-return placeholder
          and silently aborts — leaving the editor permanently uncreated. */}
      <div ref={containerRef} className="w-full h-full" />
      {!file && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{
            color: 'var(--dplex-text-muted)',
            backgroundColor: 'var(--dplex-bg)'
          }}
        >
          Select a file to view changes
        </div>
      )}
      {file && error && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm px-4 text-center"
          style={{
            color: 'var(--dplex-status-error, #f87171)',
            backgroundColor: 'var(--dplex-bg)'
          }}
        >
          {error}
        </div>
      )}
      {file && !error && content?.isBinary && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{
            color: 'var(--dplex-text-muted)',
            backgroundColor: 'var(--dplex-bg)'
          }}
        >
          Binary file — diff not shown
        </div>
      )}
      {file && loading && (
        <div
          className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded z-10"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            color: 'var(--dplex-text-muted)'
          }}
        >
          Loading…
        </div>
      )}
      {file && content?.truncated && (
        <div
          className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded z-10"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            color: 'var(--dplex-status-warning, #fbbf24)'
          }}
        >
          File truncated (&gt; 2 MB)
        </div>
      )}
      {file && isPartialStaged && (
        <div
          className="absolute bottom-2 left-2 flex items-center gap-0 text-[10px] rounded overflow-hidden z-10"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            border: '1px solid var(--dplex-border)'
          }}
        >
          <button
            type="button"
            className="px-2 py-0.5 hover:bg-[var(--dplex-hover)]"
            style={{
              backgroundColor: !stagedView ? 'var(--dplex-bg)' : 'transparent',
              color: !stagedView ? 'var(--dplex-text)' : 'var(--dplex-text-muted)'
            }}
            onClick={() => setStagedView(false)}
            title="Show unstaged changes (index ↔ working tree)"
          >
            Unstaged
          </button>
          <button
            type="button"
            className="px-2 py-0.5 hover:bg-[var(--dplex-hover)]"
            style={{
              backgroundColor: stagedView ? 'var(--dplex-bg)' : 'transparent',
              color: stagedView ? 'var(--dplex-text)' : 'var(--dplex-text-muted)'
            }}
            onClick={() => setStagedView(true)}
            title="Show staged changes (HEAD ↔ index)"
          >
            Staged
          </button>
        </div>
      )}
    </div>
  )
}
