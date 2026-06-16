import React, { useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangedFile, CommitGraphEntry } from '../../../../preload'
import type { GraphCommitRow } from './commitGraphLayout'
import { laneColor } from './commitGraphColors'
import { rowStatusBadge } from '../../utils/fileStatusBadge'
import { timeAgo } from '../../utils/timeAgo'

/** Geometry shared with CommitGraph. */
export const LANE_WIDTH = 14
export const ROW_HEIGHT = 44

const NODE_RADIUS = 4
/** Lane stroke width — bolder, VSCode-like. */
const LANE_STROKE = 2
/** Fixed height of a per-file row inside an expanded commit. */
const FILE_ROW_HEIGHT = 24

function cx(column: number): number {
  return column * LANE_WIDTH + LANE_WIDTH / 2
}

/** Cubic-bezier (or straight) path between two lane endpoints in a cell. */
function lanePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const ymid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${ymid}, ${x2} ${ymid}, ${x2} ${y2}`
}

/** Lanes leaving the bottom of a commit row — drawn as continuing vertical
 *  lines through that commit's expanded file list so the graph isn't cut. */
interface OutgoingLane {
  column: number
  color: number
}

function outgoingLanes(row: GraphCommitRow): OutgoingLane[] {
  const byColumn = new Map<number, OutgoingLane>()
  for (const t of row.through) byColumn.set(t.toColumn, { column: t.toColumn, color: t.color })
  for (const b of row.branchOuts) byColumn.set(b.toColumn, { column: b.toColumn, color: b.color })
  return [...byColumn.values()]
}

/** Vertical-only lane gutter used by the expanded file rows. */
function LaneGutter({
  lanes,
  width,
  height
}: {
  lanes: OutgoingLane[]
  width: number
  height: number
}): React.JSX.Element {
  return (
    <svg
      width={width}
      height={height}
      className="flex-shrink-0"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      {lanes.map((l) => (
        <line
          key={l.column}
          x1={cx(l.column)}
          y1={0}
          x2={cx(l.column)}
          y2={height}
          stroke={laneColor(l.color)}
          strokeWidth={LANE_STROKE}
        />
      ))}
    </svg>
  )
}

interface CommitRowProps {
  commit: CommitGraphEntry
  row: GraphCommitRow
  expanded: boolean
  files: ChangedFile[] | null
  filesLoading: boolean
  filesError: string | null
  onToggle: () => void
  onSelectFile: (file: ChangedFile, promote: boolean) => void
}

function CommitRowImpl({
  commit,
  row,
  expanded,
  files,
  filesLoading,
  filesError,
  onToggle,
  onSelectFile
}: CommitRowProps): React.JSX.Element {
  // Per-row gutter: size to the lanes THIS row uses, so a single-lane commit
  // keeps its text next to the line instead of inheriting the graph's widest
  // row. The full node (center + radius) must fit, hence the radius padding.
  const gutterWidth = Math.max(1, row.columns) * LANE_WIDTH + NODE_RADIUS + 2
  const nodeX = cx(row.nodeColumn)
  const nodeY = ROW_HEIGHT / 2

  const segments = useMemo(() => {
    const segs: { d: string; color: string }[] = []
    for (const t of row.through) {
      segs.push({
        d: lanePath(cx(t.fromColumn), 0, cx(t.toColumn), ROW_HEIGHT),
        color: laneColor(t.color)
      })
    }
    for (const m of row.mergeIns) {
      segs.push({ d: lanePath(cx(m.fromColumn), 0, nodeX, nodeY), color: laneColor(m.color) })
    }
    for (const b of row.branchOuts) {
      segs.push({
        d: lanePath(nodeX, nodeY, cx(b.toColumn), ROW_HEIGHT),
        color: laneColor(b.color)
      })
    }
    return segs
  }, [row, nodeX, nodeY])

  return (
    <li data-testid="commit-row" data-sha={commit.sha}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className="flex items-stretch cursor-pointer overflow-hidden hover:bg-[var(--dplex-hover)]"
        title={commit.subject}
      >
        {/* Graph gutter */}
        <svg
          width={gutterWidth}
          height={ROW_HEIGHT}
          className="flex-shrink-0"
          style={{ overflow: 'visible' }}
          aria-hidden="true"
        >
          {segments.map((s, i) => (
            <path key={i} d={s.d} stroke={s.color} strokeWidth={LANE_STROKE} fill="none" />
          ))}
          <circle
            cx={nodeX}
            cy={nodeY}
            r={NODE_RADIUS}
            fill={laneColor(row.nodeColor)}
            stroke="var(--dplex-bg-panel)"
            strokeWidth={1}
          />
        </svg>

        {/* Commit info */}
        <div className="flex flex-col justify-center min-w-0 flex-1 overflow-hidden pl-1.5 pr-2 py-1">
          <div className="flex items-center gap-1 min-w-0">
            <span
              className="text-[11px] flex-shrink-0"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <span
              className="truncate text-[12.5px] min-w-0 flex-1"
              style={{ color: 'var(--dplex-text)' }}
            >
              {commit.subject}
            </span>
          </div>
          <div
            className="flex items-center gap-1.5 text-[10.5px] truncate"
            style={{ color: 'var(--dplex-text-dim)' }}
          >
            <span className="truncate">{commit.authorName}</span>
            <span>·</span>
            <span className="flex-shrink-0">{timeAgo(commit.authorDate)}</span>
            <span>·</span>
            <span className="font-mono flex-shrink-0">{commit.shortSha}</span>
          </div>
        </div>
      </div>

      {expanded && (
        <CommitFiles
          files={files}
          loading={filesLoading}
          error={filesError}
          lanes={outgoingLanes(row)}
          gutterWidth={gutterWidth}
          onSelectFile={onSelectFile}
        />
      )}
    </li>
  )
}

interface CommitFilesProps {
  files: ChangedFile[] | null
  loading: boolean
  error: string | null
  lanes: OutgoingLane[]
  gutterWidth: number
  onSelectFile: (file: ChangedFile, promote: boolean) => void
}

function CommitFiles({
  files,
  loading,
  error,
  lanes,
  gutterWidth,
  onSelectFile
}: CommitFilesProps): React.JSX.Element {
  // A status/message row that still draws the continuing lanes on the left so
  // the graph is never visually cut while a commit is expanded.
  const messageRow = (text: string, color: string): React.JSX.Element => (
    <div className="flex items-center" style={{ minHeight: FILE_ROW_HEIGHT }}>
      <LaneGutter lanes={lanes} width={gutterWidth} height={FILE_ROW_HEIGHT} />
      <span className="pl-1.5 pr-2 text-[11px]" style={{ color }}>
        {text}
      </span>
    </div>
  )

  if (loading) return messageRow('Loading…', 'var(--dplex-text-muted)')
  if (error) return messageRow(error, 'var(--dplex-status-error, #f87171)')
  if (!files || files.length === 0) {
    return messageRow('No file changes', 'var(--dplex-text-muted)')
  }

  return (
    <ul style={{ backgroundColor: 'var(--dplex-bg-alt)' }}>
      {files.map((file) => {
        const badge = rowStatusBadge(file)
        const cleanPath = file.gitPath.endsWith('/') ? file.gitPath.slice(0, -1) : file.gitPath
        const lastSlash = cleanPath.lastIndexOf('/')
        const fileName = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath
        const dirPath = lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : ''
        const dirDisplay = file.oldGitPath ? `${file.oldGitPath} → ${dirPath || '.'}` : dirPath
        return (
          <li
            key={file.gitPath}
            role="button"
            tabIndex={0}
            data-git-path={file.gitPath}
            onClick={() => onSelectFile(file, false)}
            onDoubleClick={() => onSelectFile(file, true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectFile(file, false)
              }
            }}
            className="flex items-center cursor-pointer hover:bg-[var(--dplex-hover)]"
            style={{ minHeight: FILE_ROW_HEIGHT, fontSize: 12, color: 'var(--dplex-text)' }}
            title={file.oldGitPath ? `${file.oldGitPath} → ${file.gitPath}` : file.gitPath}
          >
            <LaneGutter lanes={lanes} width={gutterWidth} height={FILE_ROW_HEIGHT} />
            <span
              className="grid items-center gap-2 min-w-0 flex-1 pl-1.5 pr-2.5"
              style={{ gridTemplateColumns: 'auto 1fr' }}
            >
              <span
                className={`dplex-file-badge ${badge.cls}`}
                aria-label={`${badge.letter} status`}
              >
                {badge.letter}
              </span>
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span className="truncate">{fileName}</span>
                {dirDisplay && (
                  <span
                    className="truncate text-[10.5px]"
                    style={{ color: 'var(--dplex-text-dim)' }}
                  >
                    {dirDisplay}
                  </span>
                )}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export const CommitRow = React.memo(CommitRowImpl)
