import React from 'react'
import type { ChangedFile } from '../../../../preload'
import { rowStatusBadge } from '../../utils/fileStatusBadge'

interface ChangesListProps {
  files: ChangedFile[]
  selectedPath: string | undefined
  onSelect: (path: string) => void
  truncated: boolean
  totalCount: number
  loading: boolean
  error?: string
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
