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
    mode === 'commands'
      ? 'Type a command…'
      : 'Search projects, sessions, settings… (try #tag)'

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
        backgroundColor: 'rgba(0,0,0,0.4)',
        paddingTop: '12vh'
      }}
      data-testid="command-palette"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-[680px] mx-4 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          maxHeight: '70vh'
        }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <Search size={14} style={{ color: 'var(--dplex-text-dim)' }} />
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
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--dplex-text)' }}
            data-testid="command-palette-input"
          />
          {mode === 'commands' && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: 'var(--dplex-accent)',
                backgroundColor: 'var(--dplex-accent-soft)'
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
          className="flex items-center gap-3 px-3 py-1.5 text-[10.5px]"
          style={{
            borderTop: '1px solid var(--dplex-border)',
            color: 'var(--dplex-text-dim)'
          }}
        >
          <span className="flex items-center gap-1">
            <ChevronUp size={11} />
            <ChevronDown size={11} />
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft size={11} />
            Open
          </span>
          <span className="ml-auto">Esc to close</span>
        </div>
      </div>
    </div>
  )
}
