import { useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ShellInfo } from '../../types'

interface ShellSelectorProps {
  onSelect: (shell?: string) => void
}

let cachedShells: ShellInfo[] | null = null

export function ShellSelector({ onSelect }: ShellSelectorProps): JSX.Element {
  const [shells, setShells] = useState<ShellInfo[]>(cachedShells || [])
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cachedShells) {
      window.dplex.app.getAvailableShells().then((result) => {
        cachedShells = result
        setShells(result)
      })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (shells.length <= 1) return <></>

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center w-4 h-8 hover:bg-white/10 transition-colors flex-shrink-0"
        style={{ color: 'var(--dplex-text-muted)' }}
        title="Select shell"
      >
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute top-8 left-0 z-50 rounded shadow-xl py-1 min-w-[180px]"
          style={{
            backgroundColor: 'var(--dplex-bg)',
            border: '1px solid var(--dplex-border)'
          }}
        >
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
              <span className="text-[10px] truncate max-w-[120px]" style={{ color: 'var(--dplex-text-muted)' }}>
                {shell.path}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
