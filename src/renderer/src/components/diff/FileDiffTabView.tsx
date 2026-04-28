import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileDiffTab } from '../../types'
import { useTerminalStore } from '../../stores/terminalStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { DiffEditorPane } from './DiffEditorPane'
import { Columns2, Rows2, RefreshCw } from 'lucide-react'

interface FileDiffTabViewProps {
  tab: FileDiffTab
}

/**
 * Per-file diff tab view.
 *
 * Replaces the legacy repo-level `DiffTabView` (which embedded a changes
 * list + editor pane). The Git panel now owns the changes list; this view
 * just renders Monaco for one file plus a small header strip.
 *
 * Refresh strategy:
 *  - The Git panel's watcher drives the canonical list. We listen to global
 *    "changes-changed" events for the same repoRootFs and bump `refreshKey`
 *    so the editor re-fetches its content. If the file no longer appears in
 *    the changes list, we keep the last-known content but flag it stale.
 */
export function FileDiffTabView({ tab }: FileDiffTabViewProps): React.JSX.Element {
  const updateFileDiffTab = useTerminalStore((s) => s.updateFileDiffTab)
  const [refreshKey, setRefreshKey] = useState(0)

  // Derive the freshest ChangedFile from the Git panel cache. The tab's
  // stored snapshot is captured at open time and goes stale as soon as the
  // user stages/unstages — which would make DiffEditorPane request the
  // wrong (HEAD↔index vs index↔WT) pair. We sync the snapshot back to the
  // store when the cache record changes.
  const cachedFile = useGitPanelStore((s) => {
    const entry = s.byRepo[tab.repoRootFs]
    if (!entry) return null
    return (
      entry.files.find(
        (f) => f.gitPath === tab.file.gitPath || f.oldGitPath === tab.file.gitPath
      ) ?? null
    )
  })
  useEffect(() => {
    if (!cachedFile) return
    const current = tab.file
    if (
      cachedFile.gitPath !== current.gitPath ||
      cachedFile.oldGitPath !== current.oldGitPath ||
      cachedFile.headStatus !== current.headStatus ||
      cachedFile.wtStatus !== current.wtStatus
    ) {
      updateFileDiffTab(tab.id, { file: cachedFile })
    }
  }, [cachedFile, tab.file, tab.id, updateFileDiffTab])
  const file = useMemo(() => cachedFile ?? tab.file, [cachedFile, tab.file])

  // Editor area width drives the side-by-side ↔ inline fallback. We keep
  // the same threshold as the editor pane for consistency. Uses a callback
  // ref so we attach the observer the moment the div mounts.
  const SIDE_BY_SIDE_MIN_WIDTH = 900
  const [editorAreaWidth, setEditorAreaWidth] = useState<number>(Infinity)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const editorAreaRef = useCallback((el: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect()
      resizeObserverRef.current = null
    }
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setEditorAreaWidth(entry.contentRect.width)
      }
    })
    ro.observe(el)
    resizeObserverRef.current = ro
    setEditorAreaWidth(el.getBoundingClientRect().width)
  }, [])
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      }
    }
  }, [])

  // Refresh on watcher event for THIS repo. The Git panel store is the
  // source of truth for the changes list; we just react to events.
  useEffect(() => {
    const off = window.dplex.diff.onChangesChanged((p) => {
      if (p.repoRootFs === tab.repoRootFs) {
        setRefreshKey((k) => k + 1)
      }
    })
    return () => off()
  }, [tab.repoRootFs])

  // Refresh on focus / visibility (matches behaviour of the legacy view —
  // covers cases where the watcher missed a sync mutation done by the user
  // outside the app).
  useEffect(() => {
    const onFocus = (): void => setRefreshKey((k) => k + 1)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') setRefreshKey((k) => k + 1)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const isNewFile = file.headStatus === 'A' || file.headStatus === '?'
  const sideBySidePref = tab.sideBySide !== false
  const sideBySideForced = isNewFile || editorAreaWidth < SIDE_BY_SIDE_MIN_WIDTH
  const effectiveSideBySide = sideBySidePref && !sideBySideForced
  const sideBySideTitle = isNewFile
    ? 'Inline view (new file has no previous version to compare)'
    : sideBySideForced
      ? 'Inline view (window too narrow for side-by-side)'
      : effectiveSideBySide
        ? 'Switch to inline view'
        : 'Switch to side-by-side view'

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--dplex-bg)' }}>
      <div
        className="flex items-center gap-2 px-3 h-8 text-[11px] flex-shrink-0"
        style={{
          color: 'var(--dplex-text-muted)',
          borderBottom: '1px solid var(--dplex-border)'
        }}
      >
        <span className="truncate" title={file.gitPath}>
          {tab.repoLabel} · {file.gitPath}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--dplex-hover)] disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => updateFileDiffTab(tab.id, { sideBySide: !sideBySidePref })}
            disabled={sideBySideForced}
            title={sideBySideTitle}
          >
            {effectiveSideBySide ? <Columns2 size={12} /> : <Rows2 size={12} />}
            <span>{effectiveSideBySide ? 'Side-by-side' : 'Inline'}</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--dplex-hover)]"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      <div ref={editorAreaRef} className="flex-1 min-w-0 min-h-0">
        <DiffEditorPane
          repoRootFs={tab.repoRootFs}
          scope={tab.scope}
          file={file}
          sideBySide={effectiveSideBySide}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  )
}
