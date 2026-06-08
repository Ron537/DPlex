import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Loader2 } from 'lucide-react'
import type { FsEntry } from '../../../../preload'
import { fileIconFor } from './fileIcons'

/** Inline input state for create/rename, shared across the tree. */
export type PendingInput =
  | { kind: 'create-file'; parentRel: string }
  | { kind: 'create-folder'; parentRel: string }
  | { kind: 'rename'; relPath: string }
  | null

export interface TreeCtx {
  byDir: Record<string, FsEntry[]>
  expanded: Record<string, boolean>
  loading: Record<string, boolean>
  selectedRelPath: string | null
  openTabRelPaths: Set<string>
  pending: PendingInput
  onToggle: (relPath: string) => void
  onOpen: (relPath: string, persist: boolean) => void
  onContextMenu: (e: React.MouseEvent, relPath: string, type: 'dir' | 'file') => void
  onSubmitInput: (value: string) => void
  onCancelInput: () => void
}

const INDENT_PX = 12
const ROW_PADDING_LEFT = 8

export function InlineInput({
  depth,
  icon,
  initial,
  onSubmit,
  onCancel
}: {
  depth: number
  icon: React.JSX.Element
  initial: string
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the basename without extension for renames; full string otherwise.
    const dot = initial.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initial])
  return (
    <div
      className="flex items-center gap-1.5 h-[22px]"
      style={{ paddingLeft: ROW_PADDING_LEFT + depth * INDENT_PX }}
    >
      <span style={{ width: 14 }} />
      {icon}
      <input
        ref={ref}
        type="text"
        value={value}
        spellCheck={false}
        className="flex-1 min-w-0 text-[13px] px-1 py-0 rounded outline-none"
        style={{
          backgroundColor: 'var(--dplex-bg)',
          color: 'var(--dplex-text)',
          border: '1px solid var(--dplex-accent, #60a5fa)'
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => onSubmit(value)}
      />
    </div>
  )
}

interface FileTreeNodeProps {
  entry: FsEntry
  depth: number
  ctx: TreeCtx
}

/**
 * One row in the file tree, plus (for expanded dirs) its recursively-rendered
 * children. Lazy: children only render when the directory is expanded and its
 * listing is cached in the store.
 */
export function FileTreeNode({ entry, depth, ctx }: FileTreeNodeProps): React.JSX.Element {
  const isDir = entry.type === 'dir'
  const isExpanded = !!ctx.expanded[entry.relPath]
  const isSelected = ctx.selectedRelPath === entry.relPath
  const isOpenTab = ctx.openTabRelPaths.has(entry.relPath)
  const isRenaming = ctx.pending?.kind === 'rename' && ctx.pending.relPath === entry.relPath

  const children = isDir ? ctx.byDir[entry.relPath] : undefined
  const childLoading = isDir && ctx.loading[entry.relPath] && children === undefined

  if (isRenaming) {
    return (
      <InlineInput
        depth={depth}
        icon={
          isDir ? (
            <Folder size={14} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
          ) : (
            fileIconFor(entry.name)
          )
        }
        initial={entry.name}
        onSubmit={ctx.onSubmitInput}
        onCancel={ctx.onCancelInput}
      />
    )
  }

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        title={entry.relPath}
        className="flex items-center gap-1.5 h-[22px] cursor-pointer select-none hover:bg-[var(--dplex-hover)]"
        style={{
          paddingLeft: ROW_PADDING_LEFT + depth * INDENT_PX,
          backgroundColor: isSelected ? 'var(--dplex-bg-selected, var(--dplex-hover))' : undefined,
          color: 'var(--dplex-text)'
        }}
        onClick={() => {
          if (isDir) ctx.onToggle(entry.relPath)
          else ctx.onOpen(entry.relPath, false)
        }}
        onDoubleClick={() => {
          if (!isDir) ctx.onOpen(entry.relPath, true)
        }}
        onContextMenu={(e) => ctx.onContextMenu(e, entry.relPath, entry.type)}
      >
        {isDir ? (
          isExpanded ? (
            <ChevronDown size={14} style={{ color: 'var(--dplex-text-dim)' }} />
          ) : (
            <ChevronRight size={14} style={{ color: 'var(--dplex-text-dim)' }} />
          )
        ) : (
          <span style={{ width: 14 }} />
        )}
        {isDir ? (
          isExpanded ? (
            <FolderOpen size={14} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
          ) : (
            <Folder size={14} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
          )
        ) : (
          fileIconFor(entry.name)
        )}
        <span
          className="flex-1 min-w-0 truncate text-[13px]"
          style={{
            fontStyle: undefined,
            color: isOpenTab ? 'var(--dplex-text)' : 'var(--dplex-text-2)'
          }}
        >
          {entry.name}
        </span>
        {entry.isSymlink && (
          <span className="text-[10px] mr-1" style={{ color: 'var(--dplex-text-dim)' }}>
            ↗
          </span>
        )}
      </div>

      {isDir && isExpanded && (
        <>
          {(ctx.pending?.kind === 'create-file' || ctx.pending?.kind === 'create-folder') &&
            ctx.pending.parentRel === entry.relPath && (
              <InlineInput
                depth={depth + 1}
                icon={
                  ctx.pending.kind === 'create-folder' ? (
                    <Folder size={14} style={{ color: 'var(--dplex-accent, #60a5fa)' }} />
                  ) : (
                    fileIconFor('new')
                  )
                }
                initial=""
                onSubmit={ctx.onSubmitInput}
                onCancel={ctx.onCancelInput}
              />
            )}
          {childLoading && (
            <div
              className="flex items-center gap-1.5 h-[22px] text-[12px]"
              style={{
                paddingLeft: ROW_PADDING_LEFT + (depth + 1) * INDENT_PX,
                color: 'var(--dplex-text-dim)'
              }}
            >
              <Loader2 size={12} className="animate-spin" />
              Loading…
            </div>
          )}
          {children?.map((child) => (
            <FileTreeNode key={child.relPath} entry={child} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      )}
    </>
  )
}
