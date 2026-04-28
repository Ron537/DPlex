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
 * Priority: U (conflict) > A > D > M > R > C > T > !.
 * The renderer does NOT split into "Staged" / "Changes" sections in v1 —
 * we'll add that section split when we wire per-section actions.
 */
function rowStatusBadge(file: ChangedFile): { letter: string; color: string } {
  const codes = [file.headStatus, file.wtStatus]
  if (codes.includes('U') || file.isConflict) {
    return { letter: 'U', color: 'var(--dplex-status-error, #f87171)' }
  }
  if (codes.includes('A') || codes.includes('?')) {
    return { letter: 'A', color: 'var(--dplex-status-success, #4ade80)' }
  }
  if (codes.includes('D')) {
    return { letter: 'D', color: 'var(--dplex-status-error, #f87171)' }
  }
  if (codes.includes('R')) {
    return { letter: 'R', color: 'var(--dplex-status-info, #60a5fa)' }
  }
  if (codes.includes('C')) {
    return { letter: 'C', color: 'var(--dplex-status-info, #60a5fa)' }
  }
  if (codes.includes('M')) {
    return { letter: 'M', color: 'var(--dplex-status-warning, #fbbf24)' }
  }
  if (codes.includes('T')) {
    return { letter: 'T', color: 'var(--dplex-text-muted)' }
  }
  return { letter: '!', color: 'var(--dplex-text-muted)' }
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
        {loading && <span>Refreshing…</span>}
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
          // For renames, show "newname (oldname → newname)" in the dir slot
          // so the leading filename stays scannable.
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
              className="flex items-center gap-2 px-3 py-1 cursor-pointer text-[12px] hover:bg-[var(--dplex-hover)]"
              style={{
                backgroundColor: isSelected ? 'var(--dplex-bg)' : 'transparent',
                color: isSelected ? 'var(--dplex-text)' : 'var(--dplex-text-muted)',
                borderLeft: isSelected ? '2px solid var(--dplex-accent)' : '2px solid transparent'
              }}
              title={displayPath}
            >
              <span
                className="inline-block w-3 text-center font-mono text-[10px] flex-shrink-0"
                style={{ color: badge.color }}
              >
                {badge.letter}
              </span>
              <span className="flex items-baseline gap-1.5 min-w-0 flex-1">
                <span
                  className="flex-shrink-0 whitespace-nowrap"
                  style={{ color: 'var(--dplex-text)' }}
                >
                  {fileName}
                </span>
                {dirDisplay && (
                  <span
                    className="truncate text-[10px] min-w-0"
                    style={{ color: 'var(--dplex-text-muted)' }}
                  >
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
