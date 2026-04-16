import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { X, Search, ArrowUp, ArrowDown } from 'lucide-react'

interface SessionPrompt {
  text: string
  timestamp?: number
  index: number
}

interface PromptsDialogProps {
  sessionId: string
  sessionName: string
  providerId?: string
  onClose: () => void
}

export function PromptsDialog({
  sessionId,
  sessionName,
  providerId,
  onClose
}: PromptsDialogProps): React.JSX.Element {
  const [prompts, setPrompts] = useState<SessionPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    window.dplex.sessions
      .getPrompts(sessionId, providerId, 50)
      .then((result) => {
        // Show newest first
        setPrompts([...result].reverse())
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [sessionId, providerId])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    if (!searchQuery) return prompts
    const q = searchQuery.toLowerCase()
    return prompts.filter((p) => p.text.toLowerCase().includes(q))
  }, [prompts, searchQuery])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [filtered, selectedIndex, onClose]
  )

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const formatTime = (timestamp?: number): string => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--dplex-bg)',
          border: '1px solid var(--dplex-border)',
          width: '560px',
          maxHeight: '70vh'
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--dplex-text)' }}>
              Prompts{!loading && ` (${prompts.length})`}
            </div>
            <div className="text-[10px]" style={{ color: 'var(--dplex-text-muted)' }}>
              {sessionName}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--dplex-border)' }}>
          <div
            className="flex items-center gap-2 rounded px-2 py-1.5"
            style={{
              backgroundColor: 'var(--dplex-bg-alt)',
              border: '1px solid var(--dplex-border)'
            }}
          >
            <Search size={12} style={{ color: 'var(--dplex-text-muted)' }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Filter prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-xs outline-none w-full"
              style={{ color: 'var(--dplex-text)' }}
            />
          </div>
          <div className="flex items-center gap-2 mt-1 text-[9px]" style={{ color: 'var(--dplex-text-muted)' }}>
            <ArrowUp size={8} /><ArrowDown size={8} /> navigate
            <span className="mx-1">·</span>
            Esc to close
          </div>
        </div>

        {/* Prompt list */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="text-center py-8 text-xs" style={{ color: 'var(--dplex-text-muted)' }}>
              Loading prompts...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs" style={{ color: 'var(--dplex-text-muted)' }}>
              {prompts.length === 0 ? 'No prompts found' : 'No matching prompts'}
            </div>
          ) : (
            filtered.map((prompt, i) => (
              <div
                key={prompt.index}
                className="flex items-start gap-2 px-3 py-2 rounded transition-colors"
                style={{
                  backgroundColor:
                    i === selectedIndex ? 'var(--dplex-bg-alt)' : 'transparent'
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span
                  className="text-[9px] mt-0.5 flex-shrink-0 w-5 text-right"
                  style={{ color: 'var(--dplex-text-muted)' }}
                >
                  #{prompt.index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs whitespace-pre-wrap break-words"
                    style={{ color: 'var(--dplex-text)' }}
                  >
                    {prompt.text}
                  </div>
                  {prompt.timestamp && (
                    <div
                      className="text-[9px] mt-0.5"
                      style={{ color: 'var(--dplex-text-muted)' }}
                    >
                      {formatTime(prompt.timestamp)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  )
}
