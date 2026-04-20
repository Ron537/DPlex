export interface RawWorktreeRecord {
  path: string
  head: string
  branch: string | null
  detached: boolean
  bare: boolean
  prunable: boolean
}

export function parsePorcelain(output: string): RawWorktreeRecord[] {
  const records: RawWorktreeRecord[] = []
  let cur: Partial<RawWorktreeRecord> | null = null

  const flush = (): void => {
    if (cur && cur.path) {
      records.push({
        path: cur.path,
        head: cur.head ?? '',
        branch: cur.branch ?? null,
        detached: cur.detached ?? false,
        bare: cur.bare ?? false,
        prunable: cur.prunable ?? false
      })
    }
    cur = null
  }

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length) }
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length)
      cur.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
      cur.detached = false
    } else if (line === 'detached') {
      cur.branch = null
      cur.detached = true
    } else if (line === 'bare') {
      cur.bare = true
    } else if (line.startsWith('prunable')) {
      cur.prunable = true
    }
  }
  flush()
  return records
}
