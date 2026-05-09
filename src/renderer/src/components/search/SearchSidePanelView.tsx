import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { useGlobalSearch } from './useGlobalSearch'
import { useSearchKeyboardNav } from './useSearchKeyboardNav'
import { SearchResultsList } from './SearchResultsList'
import { useCommandPaletteStore } from '../../stores/commandPaletteStore'

const LIST_ID = 'dplex-search-side-list'

/** Activity-bar variant of the global search. Mounts only while the
 *  side panel is showing the Search view; result computation is gated by
 *  the `enabled` flag passed to {@link useGlobalSearch}. */
export function SearchSidePanelView(): React.JSX.Element {
  const search = useGlobalSearch({ enabled: true })
  const inputRef = useRef<HTMLInputElement>(null)
  const openCmdPalette = useCommandPaletteStore((s) => s.openWith)

  // Focus the input on mount so typing works immediately after activating
  // the tab. Re-focus when the global Cmd/Ctrl+F (or Cmd/Ctrl+Shift+F)
  // dispatches `dplex:focus-search` — same convention used by the
  // Projects/Sessions search inputs in `SidePanel.tsx`. Distinct from the
  // CommandPalette's open-transition focus pattern (no event listener
  // needed there because the palette is a transient modal).
  useEffect(() => {
    inputRef.current?.focus()
    const handler = (): void => inputRef.current?.focus()
    window.addEventListener('dplex:focus-search', handler)
    return () => window.removeEventListener('dplex:focus-search', handler)
  }, [])

  const onKeyDown = useSearchKeyboardNav(search)

  let active: string | undefined
  if (search.totalItems > 0) {
    active = `${LIST_ID}-opt-${search.selectedIndex}`
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex flex-col gap-2 px-3 pt-2 pb-2.5"
        style={{ borderBottom: '1px solid var(--dplex-border)' }}
      >
        <div className="flex items-center" style={{ height: 28 }}>
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--dplex-text)', letterSpacing: '0.08em' }}
          >
            Search
          </span>
          <button
            type="button"
            className="ml-auto text-[10.5px] px-2 py-0.5 rounded transition-colors"
            style={{
              color: 'var(--dplex-text-muted)',
              border: '1px solid var(--dplex-border)'
            }}
            onClick={() => openCmdPalette('all')}
            title="Open as modal"
            data-testid="search-side-open-modal"
          >
            Open as palette
          </button>
        </div>
        <div className="relative">
          <Search
            size={13}
            style={{
              position: 'absolute',
              left: 9,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--dplex-text-dim)',
              pointerEvents: 'none'
            }}
          />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search anything…"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-controls={LIST_ID}
            aria-activedescendant={active}
            aria-autocomplete="list"
            className="w-full text-[12.5px] outline-none transition-colors"
            style={{
              backgroundColor: 'var(--dplex-bg-input)',
              border: '1px solid var(--dplex-border)',
              borderRadius: 8,
              color: 'var(--dplex-text)',
              padding: '8px 32px 8px 28px',
              fontFamily: 'inherit'
            }}
            data-testid="search-side-input"
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--dplex-accent)'
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--dplex-accent-soft)'
              e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--dplex-border)'
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.backgroundColor = 'var(--dplex-bg-input)'
            }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto dplex-scroll-autohide">
        <SearchResultsList
          groups={search.groups}
          selectedIndex={search.selectedIndex}
          onSelect={search.setSelectedIndex}
          onActivate={(item) => {
            void Promise.resolve(item.run())
          }}
          listId={LIST_ID}
          emptyMessage={search.query.trim() === '' ? 'Type to search' : 'No matches'}
        />
      </div>
    </div>
  )
}
