import React from 'react'
import type { ChangedFile } from '../../../../preload'

interface ChangesListProps {
  files: ChangedFile[]
  selectedPath: string | undefined
  onSelect: (path: string) => void
  truncated: boolean
  totalCount: number
  loading: boolean
  error?: string
}

/**
 * Status code badge — single character. Combines head/wt for the row badge.
 *
 * Returns the letter + the matching `.dplex-file-*` class so the row
 * renders with the polished colored chip style (rounded square with
 * mono letter), matching the preview's git inspector.
 *
 * Priority: U (conflict) > A > D > M > R > C > T > !.
 * The renderer does NOT split into "Staged" / "Changes" sections in v1 —
 * we'll add that section split when we wire per-section actions.
 */
function rowStatusBadge(file: ChangedFile): { letter: string; cls: string } {
  const codes = [file.headStatus, file.wtStatus]
  if (codes.includes('U') || file.isConflict) return { letter: 'U', cls: 'dplex-file-U' }
  if (codes.includes('A') || codes.includes('?')) return { letter: 'A', cls: 'dplex-file-A' }
  if (codes.includes('D')) return { letter: 'D', cls: 'dplex-file-D' }
  if (codes.includes('R')) return { letter: 'R', cls: 'dplex-file-R' }
  if (codes.includes('C')) return { letter: 'C', cls: 'dplex-file-R' }
  if (codes.includes('M')) return { letter: 'M', cls: 'dplex-file-M' }
  if (codes.includes('T')) return { letter: 'T', cls: 'dplex-file-default' }
  return { letter: '!', cls: 'dplex-file-default' }
}

export function ChangesList({
  files,
  selectedPath,
  onSelect,
  truncated,
  totalCount,
  loading,
  error
}: ChangesListProps): React.JSX.Element {
  // Only surface "Refreshing…" on the initial load (no files yet).
  // Background refreshes triggered by the fs watcher stay silent — the
  // list updates in place when the new data arrives.
  const showRefreshing = loading && files.length === 0
  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ backgroundColor: 'var(--dplex-bg-alt)' }}
    >
      <div
        className="px-3 py-2 text-[11px] flex items-center justify-between sticky top-0 z-10"
        style={{
          backgroundColor: 'var(--dplex-bg-alt)',
          borderBottom: '1px solid var(--dplex-border)',
          color: 'var(--dplex-text-muted)'
        }}
      >
        <span>
          Changes{' '}
          {totalCount > 0 && <span style={{ color: 'var(--dplex-text)' }}>({totalCount})</span>}
        </span>
        {showRefreshing && <span>Refreshing…</span>}
      </div>

      {error && (
        <div
          className="px-3 py-2 text-[11px]"
          style={{ color: 'var(--dplex-status-error, #f87171)' }}
        >
          {error}
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div
          className="px-3 py-4 text-[11px] text-center"
          style={{ color: 'var(--dplex-text-muted)' }}
        >
          No changes
        </div>
      )}

      <ul className="flex-1">
        {files.map((file) => {
          const isSelected = file.gitPath === selectedPath
          const badge = rowStatusBadge(file)
          const displayPath = file.oldGitPath
            ? `${file.oldGitPath} → ${file.gitPath}`
            : file.gitPath
          // Split path → "filename" + "directory" so the filename can lead.
          // VS Code's SCM view does the same; it makes the list readable
          // when many files share long parent paths. Strip any trailing
          // slash defensively — git may report untracked dirs as `path/`.
          const cleanPath = file.gitPath.endsWith('/') ? file.gitPath.slice(0, -1) : file.gitPath
          const lastSlash = cleanPath.lastIndexOf('/')
          const fileName = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath
          const dirPath = lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : ''
          // For renames, show "oldname → newname" in the dir slot so the
          // leading filename stays scannable.
          const dirDisplay = file.oldGitPath ? `${file.oldGitPath} → ${dirPath || '.'}` : dirPath
          return (
            <li
              key={file.gitPath}
              role="button"
              tabIndex={0}
              data-git-path={file.gitPath}
              onClick={() => onSelect(file.gitPath)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(file.gitPath)
                }
              }}
              className="grid items-center gap-2.5 cursor-pointer hover:bg-[var(--dplex-hover)]"
              style={{
                gridTemplateColumns: 'auto 1fr',
                padding: '7px 14px',
                fontSize: 12.5,
                color: 'var(--dplex-text)',
                backgroundColor: isSelected ? 'var(--dplex-accent-soft)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--dplex-accent)' : '2px solid transparent'
              }}
              title={displayPath}
            >
              <span
                className={`dplex-file-badge ${badge.cls}`}
                aria-label={`${badge.letter} status`}
              >
                {badge.letter}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="truncate" style={{ color: 'var(--dplex-text)' }}>
                  {fileName}
                </span>
                {dirDisplay && (
                  <span className="truncate text-[11px]" style={{ color: 'var(--dplex-text-dim)' }}>
                    {dirDisplay}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      {truncated && (
        <div
          className="px-3 py-2 text-[10px] sticky bottom-0"
          style={{
            backgroundColor: 'var(--dplex-bg-alt)',
            borderTop: '1px solid var(--dplex-border)',
            color: 'var(--dplex-status-warning, #fbbf24)'
          }}
        >
          Truncated — only first {files.length} of {totalCount} files shown.
        </div>
      )}
    </div>
  )
}
