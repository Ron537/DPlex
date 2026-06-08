import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FilePlus,
  FolderPlus,
  RefreshCw,
  ChevronsDownUp,
  AlertTriangle,
  Folder
} from 'lucide-react'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { FileTreeNode, InlineInput, type TreeCtx, type PendingInput } from './FileTreeNode'
import { ExplorerContextMenu, type ContextMenuTarget } from './ExplorerContextMenu'
import { fileIconFor } from './fileIcons'

/** POSIX dirname (`'a/b'` → `'a'`, `'a'` → `''`). */
function parentRel(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

interface DeleteTarget {
  relPath: string
  name: string
  type: 'dir' | 'file'
}

/**
 * The file tree body + its toolbar (new file / new folder / refresh / collapse)
 * and all tree-local interaction state (inline create/rename input, context
 * menu, delete confirmation). Reads/writes everything through
 * `fileExplorerStore`.
 */
export function FileTree(): React.JSX.Element {
  const activeRootFs = useFileExplorerStore((s) => s.activeRootFs)
  const root = useFileExplorerStore((s) => (s.activeRootFs ? s.roots[s.activeRootFs] : undefined))
  const selectedRelPath = useFileExplorerStore((s) => s.selectedRelPath)
  const toggleDir = useFileExplorerStore((s) => s.toggleDir)
  const openFile = useFileExplorerStore((s) => s.openFile)
  const select = useFileExplorerStore((s) => s.select)
  const refresh = useFileExplorerStore((s) => s.refresh)
  const collapseAll = useFileExplorerStore((s) => s.collapseAll)
  const createFile = useFileExplorerStore((s) => s.createFile)
  const createDir = useFileExplorerStore((s) => s.createDir)
  const rename = useFileExplorerStore((s) => s.rename)
  const deletePath = useFileExplorerStore((s) => s.deletePath)

  const groups = useTerminalStore((s) => s.groups)
  const openTabRelPaths = useMemo(() => {
    const set = new Set<string>()
    if (!activeRootFs) return set
    for (const g of groups) {
      for (const t of g.tabs) {
        if (t.kind === 'fileEditor' && t.rootFs === activeRootFs) set.add(t.relPath)
      }
    }
    return set
  }, [groups, activeRootFs])

  const [pending, setPending] = useState<PendingInput>(null)
  const [menu, setMenu] = useState<ContextMenuTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const rootEntries = root?.byDir[''] ?? []

  const startCreate = (parentDir: string, kind: 'file' | 'folder'): void => {
    // Ensure the parent dir is expanded so the inline input is visible.
    if (parentDir !== '' && !root?.expanded[parentDir]) toggleDir(parentDir)
    setPending(
      kind === 'file'
        ? { kind: 'create-file', parentRel: parentDir }
        : { kind: 'create-folder', parentRel: parentDir }
    )
  }

  const submitInput = async (raw: string): Promise<void> => {
    const value = raw.trim()
    const cur = pending
    setPending(null)
    if (!cur || !value) return
    let res: { ok: boolean; message?: string }
    if (cur.kind === 'create-file') res = await createFile(cur.parentRel, value)
    else if (cur.kind === 'create-folder') res = await createDir(cur.parentRel, value)
    else res = await rename(cur.relPath, value)
    if (!res.ok) setActionError(res.message ?? 'Operation failed')
  }

  const confirmDelete = async (): Promise<void> => {
    const t = deleteTarget
    setDeleteTarget(null)
    if (!t) return
    const res = await deletePath(t.relPath)
    if (!res.ok) setActionError(res.message ?? 'Delete failed')
  }

  // Context-menu target dir for "new" ops: the dir itself, or the parent of a
  // file, or root.
  const createParentFor = (target: ContextMenuTarget): string =>
    target.type === 'dir' ? target.relPath : target.type === 'file' ? parentRel(target.relPath) : ''

  const ctx: TreeCtx = {
    byDir: root?.byDir ?? {},
    expanded: root?.expanded ?? {},
    loading: root?.loading ?? {},
    selectedRelPath,
    openTabRelPaths,
    pending,
    onToggle: (relPath) => {
      select(relPath)
      toggleDir(relPath)
    },
    onOpen: (relPath, persist) => {
      select(relPath)
      openFile(relPath, { promote: persist })
    },
    onContextMenu: (e, relPath, type) => {
      e.preventDefault()
      e.stopPropagation()
      select(relPath)
      setMenu({ x: e.clientX, y: e.clientY, relPath, type })
    },
    onSubmitInput: (v) => void submitInput(v),
    onCancelInput: () => setPending(null)
  }

  if (!activeRootFs) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <span className="text-[12px]" style={{ color: 'var(--dplex-text-muted)' }}>
          Select a project to browse its files.
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex items-center gap-1 px-2 h-7 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--dplex-border-subtle)' }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-wider truncate flex-1"
          style={{ color: 'var(--dplex-text-2)', letterSpacing: '0.08em' }}
        >
          Files
        </span>
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="New File"
          onClick={() => startCreate('', 'file')}
          data-testid="explorer-new-file"
        >
          <FilePlus size={13} />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="New Folder"
          onClick={() => startCreate('', 'folder')}
          data-testid="explorer-new-folder"
        >
          <FolderPlus size={13} />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Collapse All"
          onClick={() => collapseAll()}
        >
          <ChevronsDownUp size={13} />
        </button>
        <button
          type="button"
          className="p-1 rounded hover:bg-[var(--dplex-hover)]"
          style={{ color: 'var(--dplex-text-muted)' }}
          title="Refresh"
          onClick={() => refresh()}
          data-testid="explorer-refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto py-1"
        role="tree"
        onContextMenu={(e) => {
          // Right-click on empty area → root context menu.
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, relPath: '', type: 'root' })
        }}
      >
        {(pending?.kind === 'create-file' || pending?.kind === 'create-folder') &&
          pending.parentRel === '' && (
            <InlineInput
              key="__root_input__"
              depth={0}
              icon={
                pending.kind === 'create-folder' ? (
                  <Folder size={14} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
                ) : (
                  fileIconFor('new')
                )
              }
              initial=""
              onSubmit={(v) => void submitInput(v)}
              onCancel={() => setPending(null)}
            />
          )}
        {rootEntries.length === 0 && !root?.loading[''] && (
          <div className="px-3 py-2 text-[12px]" style={{ color: 'var(--dplex-text-dim)' }}>
            Empty project.
          </div>
        )}
        {rootEntries.map((entry) => (
          <FileTreeNode key={entry.relPath} entry={entry} depth={0} ctx={ctx} />
        ))}
      </div>

      {menu && (
        <ExplorerContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onNewFile={() => startCreate(createParentFor(menu), 'file')}
          onNewFolder={() => startCreate(createParentFor(menu), 'folder')}
          onRename={() => setPending({ kind: 'rename', relPath: menu.relPath })}
          onDelete={() => {
            const name = menu.relPath.includes('/')
              ? menu.relPath.slice(menu.relPath.lastIndexOf('/') + 1)
              : menu.relPath
            setDeleteTarget({
              relPath: menu.relPath,
              name,
              type: menu.type === 'dir' ? 'dir' : 'file'
            })
          }}
        />
      )}

      {deleteTarget &&
        createPortal(
          <div className="fixed inset-0 z-[2000] flex items-center justify-center">
            <div
              className="absolute inset-0"
              style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
              onClick={() => setDeleteTarget(null)}
            />
            <div
              className="relative rounded-lg shadow-2xl p-5 w-[360px]"
              style={{
                backgroundColor: 'var(--dplex-bg-panel)',
                border: '1px solid var(--dplex-border)'
              }}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={20}
                  style={{ color: 'var(--dplex-status-error, #f87171)' }}
                  className="flex-shrink-0 mt-0.5"
                />
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold" style={{ color: 'var(--dplex-text)' }}>
                    Delete {deleteTarget.type === 'dir' ? 'folder' : 'file'}?
                  </h3>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--dplex-text-muted)' }}>
                    “{deleteTarget.name}” will be permanently deleted
                    {deleteTarget.type === 'dir' ? ', including its contents' : ''}. This cannot be
                    undone.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-1.5 text-[12px] rounded hover:bg-[var(--dplex-hover)]"
                  style={{ color: 'var(--dplex-text)', border: '1px solid var(--dplex-border)' }}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-[12px] rounded text-white"
                  style={{ backgroundColor: 'var(--dplex-status-error, #ef4444)' }}
                  onClick={() => void confirmDelete()}
                  data-testid="explorer-confirm-delete"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {actionError &&
        createPortal(
          <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[2100] px-3 py-2 rounded shadow-lg text-[12px] flex items-center gap-2"
            style={{
              backgroundColor: 'var(--dplex-bg-panel)',
              border: '1px solid var(--dplex-status-error, #ef4444)',
              color: 'var(--dplex-text)'
            }}
          >
            <AlertTriangle size={14} style={{ color: 'var(--dplex-status-error, #f87171)' }} />
            <span>{actionError}</span>
            <button
              type="button"
              className="ml-2 underline"
              style={{ color: 'var(--dplex-text-muted)' }}
              onClick={() => setActionError(null)}
            >
              Dismiss
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
