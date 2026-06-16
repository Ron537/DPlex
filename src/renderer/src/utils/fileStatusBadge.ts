import type { ChangedFile } from '../../../preload'

/**
 * Status code badge for a changed file — a single letter plus the matching
 * `.dplex-file-*` chip class. Shared by the working-tree Changes list and the
 * commit-graph per-commit file list.
 *
 * Priority: U (conflict) > A > D > M > R > C > T > !.
 */
export function rowStatusBadge(file: ChangedFile): { letter: string; cls: string } {
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
