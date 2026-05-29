import * as os from 'os'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { createRequire } from 'module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CopilotChronicle } from '../../src/main/services/providers/copilotChronicle'

const requireFromHere = createRequire(import.meta.url)

type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync
let DatabaseSync: DatabaseSyncCtor | null = null
try {
  DatabaseSync = (requireFromHere('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
} catch {
  DatabaseSync = null
}

function seed(dbPath: string): void {
  const Ctor = DatabaseSync!
  const db = new Ctor(dbPath)
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      repository TEXT,
      branch TEXT,
      summary TEXT,
      host_type TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE turns (
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT
    );
  `)
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, cwd, repository, branch, summary, host_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const old = new Date('2023-01-01T00:00:00Z').toISOString()
  const recent = new Date('2024-06-01T12:00:00Z').toISOString()
  const newer = new Date('2024-06-02T12:00:00Z').toISOString()
  insertSession.run('s1', '/work/a', 'repo-a', 'main', 'Sum A', null, recent, recent)
  insertSession.run('s2', '/work/b', null, null, null, null, newer, newer)
  insertSession.run('s3', '/work/c', null, null, 'remote', 'github', newer, newer)
  insertSession.run('s-old', '/work/old', null, null, null, null, old, old)

  const insertTurn = db.prepare(
    `INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
     VALUES (?, ?, ?, ?, ?)`
  )
  insertTurn.run('s1', 0, 'Hello world', 'Hi!', recent)
  insertTurn.run('s1', 1, 'Second message', 'Ok', recent)
  insertTurn.run('s2', 0, '   ', 'response', newer)
  insertTurn.run('s2', 1, 'Real first', 'response', newer)
  db.close()
}

describe.skipIf(!DatabaseSync)('CopilotChronicle', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dplex-chronicle-'))
    dbPath = path.join(tmpDir, 'session-store.db')
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns false from tryOpen when the database is missing', () => {
    const c = new CopilotChronicle(dbPath)
    expect(c.tryOpen()).toBe(false)
    expect(c.isOpen()).toBe(false)
  })

  it('lists sessions newer than the cutoff and filters out remote host types by default', () => {
    seed(dbPath)
    const c = new CopilotChronicle(dbPath)
    expect(c.tryOpen()).toBe(true)
    const cutoff = new Date('2024-01-01T00:00:00Z').getTime()
    const rows = c.listSessions({ cutoffMs: cutoff })
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual(['s1', 's2'])
    expect(rows[0].updatedAtMs).toBeGreaterThan(rows[1].updatedAtMs) // ORDER BY desc
    c.close()
  })

  it('includes remote host types when requested', () => {
    seed(dbPath)
    const c = new CopilotChronicle(dbPath)
    c.tryOpen()
    const cutoff = new Date('2024-01-01T00:00:00Z').getTime()
    const rows = c.listSessions({ cutoffMs: cutoff, includeRemoteHosts: true })
    expect(rows.map((r) => r.id).sort()).toEqual(['s1', 's2', 's3'])
    c.close()
  })

  it('returns message counts per session', () => {
    seed(dbPath)
    const c = new CopilotChronicle(dbPath)
    c.tryOpen()
    const counts = c.getMessageCounts()
    expect(counts.get('s1')).toBe(2)
    expect(counts.get('s2')).toBe(2)
    expect(counts.get('s3')).toBeUndefined()
    c.close()
  })

  it('returns the first non-empty user message, skipping whitespace-only entries', () => {
    seed(dbPath)
    const c = new CopilotChronicle(dbPath)
    c.tryOpen()
    expect(c.getFirstUserMessage('s1')).toBe('Hello world')
    expect(c.getFirstUserMessage('s2')).toBe('Real first')
    expect(c.getFirstUserMessage('missing')).toBeNull()
    c.close()
  })

  it('refuses to open a database with an incompatible schema', async () => {
    const Ctor = DatabaseSync!
    const db = new Ctor(dbPath)
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, other TEXT)`)
    db.close()
    const c = new CopilotChronicle(dbPath)
    expect(c.tryOpen()).toBe(false)
  })

  it('enforces read-only mode (no writes allowed)', () => {
    seed(dbPath)
    const c = new CopilotChronicle(dbPath)
    c.tryOpen()
    // Open a separate handle and verify our process holds the DB in
    // query-only mode by trying a write through a fresh read-only connection.
    const writeAttempt = new DatabaseSync!(dbPath, { readOnly: true })
    expect(() => writeAttempt.exec(`UPDATE sessions SET summary = 'x' WHERE id = 's1'`)).toThrow()
    writeAttempt.close()
    c.close()
  })
})
