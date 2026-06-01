import { useEffect, useMemo, useRef } from 'react'
import { Search, ChevronUp, ChevronDown, CornerDownLeft } from 'lucide-react'
import { useCommandPaletteStore } from '../../stores/commandPaletteStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useGlobalSearch } from './useGlobalSearch'
import { useSearchKeyboardNav } from './useSearchKeyboardNav'
import { SearchResultsList } from './SearchResultsList'
import type { SearchCategory } from '../../services/search/types'

const COMMAND_ONLY: ReadonlyArray<SearchCategory> = ['commands']

const LIST_ID = 'dplex-cmd-palette-list'

export function CommandPalette(): React.JSX.Element | null {
  const open = useCommandPaletteStore((s) => s.open)
  const mode = useCommandPaletteStore((s) => s.mode)
  const close = useCommandPaletteStore((s) => s.close)

  const categories = useMemo(() => (mode === 'commands' ? COMMAND_ONLY : undefined), [mode])

  // In commands-only mode, lift the per-group caps so every command is
  // always visible (both before typing and after — the list is small).
  const isCommandsMode = mode === 'commands'
  const search = useGlobalSearch({
    enabled: open,
    categories,
    maxPerGroup: isCommandsMode ? 100 : undefined,
    emptyQueryLimit: isCommandsMode ? 100 : undefined
  })
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on Escape from anywhere — uses the shared hook so the listener is
  // installed on `document` and survives focus moving outside the input.
  useEscapeKey(close, open)

  // Focus the input each time the modal opens.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Restore focus to the previously-focused element on close.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [open])

  // Shared keyboard navigation handler — used by both palette + side-panel
  // surfaces to keep their behavior in sync.
  const handleNavKey = useSearchKeyboardNav(search, { onActivate: close })

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Tab') {
      // Trap focus inside the palette to honor `aria-modal="true"`. The input
      // is the only natively-focusable element in the dialog, so any Tab
      // (or Shift+Tab) press is intercepted and re-focuses the input.
      e.preventDefault()
      inputRef.current?.focus()
      return
    }
    handleNavKey(e)
  }

  const placeholder =
    mode === 'commands' ? 'Type a command…' : 'Search projects, sessions, settings… (try #tag)'

  // Compute the active descendant id for the input.
  let active: string | undefined
  if (search.totalItems > 0) {
    active = `${LIST_ID}-opt-${search.selectedIndex}`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'commands' ? 'Command runner' : 'Global search'}
      className="fixed inset-0 z-[200] flex items-start justify-center"
      onMouseDown={(e) => {
        // Click outside the panel closes the modal. Clicks inside the panel
        // are stopped at the panel's own onMouseDown.
        if (e.target === e.currentTarget) close()
      }}
      style={{
        backgroundColor: 'rgba(10,10,12,0.65)',
        backdropFilter: 'blur(8px)',
        paddingTop: '14vh'
      }}
      data-testid="command-palette"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-[680px] mx-4 rounded-xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: 'var(--dplex-shadow-xl)',
          maxHeight: '70vh'
        }}
      >
        <div
          className="flex items-center gap-3.5"
          style={{
            borderBottom: '1px solid var(--dplex-border)',
            padding: '18px 20px'
          }}
        >
          <Search
            size={18}
            strokeWidth={2}
            style={{ color: 'var(--dplex-text-muted)', flexShrink: 0 }}
          />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            role="combobox"
            aria-expanded
            aria-controls={LIST_ID}
            aria-activedescendant={active}
            aria-autocomplete="list"
            className="dplex-palette-input flex-1 bg-transparent outline-none"
            style={{
              color: 'var(--dplex-text)',
              fontWeight: 400,
              fontSize: 16,
              lineHeight: 1.2,
              fontFamily: 'var(--dplex-font-sans)'
            }}
            data-testid="command-palette-input"
          />
          {mode === 'commands' && (
            <span
              className="text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider"
              style={{
                color: 'var(--dplex-accent)',
                backgroundColor: 'var(--dplex-accent-soft)',
                border: '1px solid var(--dplex-accent-ring)',
                fontFamily: 'var(--dplex-font-mono)',
                letterSpacing: '0.06em'
              }}
            >
              Commands
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto dplex-scroll-autohide">
          <SearchResultsList
            groups={search.groups}
            selectedIndex={search.selectedIndex}
            onSelect={search.setSelectedIndex}
            onActivate={(item) => {
              void Promise.resolve(item.run())
              close()
            }}
            listId={LIST_ID}
            emptyMessage={
              search.query.trim() === ''
                ? mode === 'commands'
                  ? 'No commands available'
                  : 'Type to search'
                : 'No matches'
            }
          />
        </div>
        <div
          className="flex items-center gap-4 px-5 text-[10.5px]"
          style={{
            borderTop: '1px solid var(--dplex-border-subtle)',
            color: 'var(--dplex-text-dim)',
            height: 34,
            backgroundColor: 'var(--dplex-bg-elev-2)'
          }}
        >
          <span className="flex items-center gap-1.5">
            <kbd
              className="inline-flex items-center justify-center"
              style={{
                fontFamily: 'var(--dplex-font-mono)',
                background: 'var(--dplex-bg-elev-3)',
                border: '1px solid var(--dplex-border)',
                borderRadius: 3,
                padding: '1px 4px',
                color: 'var(--dplex-text-2)',
                fontSize: 9
              }}
            >
              <ChevronUp size={9} />
            </kbd>
            <kbd
              className="inline-flex items-center justify-center"
              style={{
                fontFamily: 'var(--dplex-font-mono)',
                background: 'var(--dplex-bg-elev-3)',
                border: '1px solid var(--dplex-border)',
                borderRadius: 3,
                padding: '1px 4px',
                color: 'var(--dplex-text-2)',
                fontSize: 9
              }}
            >
              <ChevronDown size={9} />
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd
              className="inline-flex items-center justify-center"
              style={{
                fontFamily: 'var(--dplex-font-mono)',
                background: 'var(--dplex-bg-elev-3)',
                border: '1px solid var(--dplex-border)',
                borderRadius: 3,
                padding: '1px 4px',
                color: 'var(--dplex-text-2)',
                fontSize: 9
              }}
            >
              <CornerDownLeft size={9} />
            </kbd>
            Open
          </span>
          <span className="ml-auto" style={{ fontFamily: 'var(--dplex-font-mono)' }}>
            Esc to close
          </span>
        </div>
      </div>
    </div>
  )
}
