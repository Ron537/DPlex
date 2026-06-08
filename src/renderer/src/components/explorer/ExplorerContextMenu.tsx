import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FilePlus, FolderPlus, Pencil, Trash2 } from 'lucide-react'

export interface ContextMenuTarget {
  x: number
  y: number
  /** relPath of the right-clicked entry, or '' for the root/empty area. */
  relPath: string
  type: 'dir' | 'file' | 'root'
}

interface ExplorerContextMenuProps {
  target: ContextMenuTarget
  onClose: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onRename: () => void
  onDelete: () => void
}

function MenuItem({
  icon,
  label,
  onClick,
  onClose,
  danger
}: {
  icon: React.JSX.Element
  label: string
  onClick: () => void
  onClose: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--dplex-hover)]"
      style={{ color: danger ? 'var(--dplex-status-error, #f87171)' : 'var(--dplex-text)' }}
      onClick={() => {
        onClick()
        onClose()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/**
 * Cursor-positioned context menu for the file tree. Portals to `document.body`
 * so it isn't clipped by the scrollable tree, and clamps to the viewport.
 */
export function ExplorerContextMenu({
  target,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete
}: ExplorerContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: target.y,
    left: target.x,
    visibility: 'hidden'
  })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const m = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 8
    let left = target.x
    let top = target.y
    if (left + m.width + pad > vw) left = Math.max(pad, vw - m.width - pad)
    if (top + m.height + pad > vh) top = Math.max(pad, vh - m.height - pad)
    setPos({ top, left, visibility: 'visible' })
  }, [target.x, target.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isEntry = target.type !== 'root'

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[1000]"
        onMouseDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        className="fixed z-[1001] rounded-md shadow-xl py-1 min-w-[160px]"
        style={{
          top: pos.top,
          left: pos.left,
          visibility: pos.visibility,
          backgroundColor: 'var(--dplex-bg)',
          border: '1px solid var(--dplex-border)'
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MenuItem
          icon={<FilePlus size={13} />}
          label="New File"
          onClick={onNewFile}
          onClose={onClose}
        />
        <MenuItem
          icon={<FolderPlus size={13} />}
          label="New Folder"
          onClick={onNewFolder}
          onClose={onClose}
        />
        {isEntry && (
          <>
            <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border-subtle)' }} />
            <MenuItem
              icon={<Pencil size={13} />}
              label="Rename"
              onClick={onRename}
              onClose={onClose}
            />
            <MenuItem
              icon={<Trash2 size={13} />}
              label="Delete"
              onClick={onDelete}
              onClose={onClose}
              danger
            />
          </>
        )}
      </div>
    </>,
    document.body
  )
}
