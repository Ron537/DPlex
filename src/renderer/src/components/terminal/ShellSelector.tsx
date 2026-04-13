import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ShellInfo } from '../../types'

interface ShellSelectorProps {
  onSelect: (shell?: string) => void
}

let cachedShells: ShellInfo[] | null = null

export function ShellSelector({ onSelect }: ShellSelectorProps): React.JSX.Element {
  const [shells, setShells] = useState<ShellInfo[]>(cachedShells || [])
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const loadShells = useCallback(async () => {
    if (cachedShells) {
      setShells(cachedShells)
      return
    }
    const result = await window.dplex.app.getAvailableShells()
    cachedShells = result
    setShells(result)
  }, [])

  useEffect(() => {
    loadShells()
  }, [loadShells])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Calculate dropdown position relative to viewport
  const getMenuStyle = (): React.CSSProperties => {
    if (!buttonRef.current) return {}
    const rect = buttonRef.current.getBoundingClientRect()
    return {
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      zIndex: 9999,
      backgroundColor: 'var(--dplex-bg)',
      border: '1px solid var(--dplex-border)',
      borderRadius: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      minWidth: '200px'
    }
  }

  const handleClick = async (): Promise<void> => {
    if (shells.length === 0) await loadShells()
    setOpen(!open)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        className="flex items-center justify-center w-5 h-8 hover:bg-white/10 transition-colors flex-shrink-0"
        style={{ color: 'var(--dplex-text-muted)' }}
        title="Select shell type"
      >
        <ChevronDown size={10} />
      </button>

      {open && shells.length > 0 && (
        <div ref={menuRef} className="py-1" style={getMenuStyle()}>
          {shells.map((shell) => (
            <button
              key={shell.path}
              onClick={() => {
                setOpen(false)
                onSelect(shell.path)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between gap-4"
              style={{ color: 'var(--dplex-text)' }}
            >
              <span className="font-medium">{shell.name}</span>
              <span className="text-[10px] truncate max-w-[140px]" style={{ color: 'var(--dplex-text-muted)' }}>
                {shell.path}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
