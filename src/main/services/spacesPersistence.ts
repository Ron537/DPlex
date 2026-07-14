import * as fs from 'fs'
import { app } from 'electron'
import * as path from 'path'
import { loadWorkspace } from './sessionPersistence'

const SPACES_FILENAME = 'spaces.json'
const SPACES_VERSION = 1

/** Default identity for the Space that legacy workspaces migrate into. */
const MIGRATED_SPACE_ID = 'space-my-work'
const MIGRATED_SPACE_NAME = 'My Work'
const MIGRATED_SPACE_COLOR = '#6E8BFF'

function spacesPath(): string {
  return path.join(app.getPath('userData'), SPACES_FILENAME)
}

/**
 * A Space as stored on disk. `workspace` is the lossy persisted workspace form
 * (same shape written to the legacy sessions.json); it is treated opaquely
 * here — the renderer owns its schema and reconstructs it on load.
 */
export interface PersistedSpace {
  id: string
  name: string
  color: string
  glyph?: string
  projectIds: string[]
  workspace: unknown
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  archived?: boolean
}

export interface PersistedSpacesFile {
  version: number
  spaces: PersistedSpace[]
  activeSpaceId: string | null
}

function isValidSpacesFile(value: unknown): value is PersistedSpacesFile {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  // Require a known, positive-integer schema version. Reject future versions (an
  // older build must not load a newer file and silently down-convert it on the
  // next save) as well as bogus versions (0, negatives, fractions).
  if (
    typeof v.version !== 'number' ||
    !Number.isInteger(v.version) ||
    v.version < 1 ||
    v.version > SPACES_VERSION
  ) {
    return false
  }
  if (!Array.isArray(v.spaces)) return false
  // Every entry must be a non-null object — a malformed element (e.g. `null`)
  // would otherwise crash the renderer's hydrate when it reads `.workspace`.
  if (!v.spaces.every((s) => !!s && typeof s === 'object')) return false
  const active = v.activeSpaceId
  return active === null || typeof active === 'string'
}

/**
 * Outcome of reading spaces.json. These states must be handled differently: a
 * valid file is used as-is (even when its `spaces` array is empty); a genuinely
 * absent file is safe to migrate a legacy workspace into; a corrupt or
 * newer-schema ("unsupported") file must be preserved, never overwritten.
 */
type SpacesLoadOutcome =
  | { status: 'ok'; file: PersistedSpacesFile }
  | { status: 'absent' }
  | { status: 'corrupt' }
  | { status: 'unsupported' }

function readSpacesFile(): SpacesLoadOutcome {
  const p = spacesPath()
  let raw: string
  try {
    if (!fs.existsSync(p)) return { status: 'absent' }
    raw = fs.readFileSync(p, 'utf-8')
  } catch {
    // Present but unreadable (permissions / transient IO) — treat as corrupt so
    // we never migrate over it.
    return { status: 'corrupt' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'corrupt' }
  }
  if (isValidSpacesFile(parsed)) return { status: 'ok', file: parsed }
  const version = (parsed as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > SPACES_VERSION) {
    return { status: 'unsupported' }
  }
  return { status: 'corrupt' }
}

/** Load and validate spaces.json, returning the parsed file or null when it is
 *  absent, corrupt, or written by an unsupported (newer) schema version. Does
 *  not migrate or move anything aside — use loadOrMigrateSpaces for boot. */
export function loadSpaces(): PersistedSpacesFile | null {
  const outcome = readSpacesFile()
  return outcome.status === 'ok' ? outcome.file : null
}

export function saveSpaces(data: PersistedSpacesFile): void {
  try {
    const p = spacesPath()
    const tmpPath = p + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
    fs.renameSync(tmpPath, p)
  } catch (err) {
    // The next debounced/sync save will retry, but log so a persistent failure
    // (e.g. a read-only userData dir) is diagnosable rather than silent.
    console.error('[spaces] failed to save spaces.json:', err)
  }
}

/** Move an unusable (corrupt or newer-schema) spaces.json aside so its data is
 *  never silently overwritten by the fresh file the renderer will persist. */
function preserveUnusableSpacesFile(kind: 'corrupt' | 'unsupported'): void {
  try {
    const p = spacesPath()
    if (!fs.existsSync(p)) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${p}.${kind}-${stamp}.bak`
    try {
      // Move it aside so the path is free for the fresh file the renderer writes.
      fs.renameSync(p, backup)
    } catch {
      // Rename can fail on some filesystems or under a transient lock — fall back
      // to a copy so the original data still survives the next save that
      // overwrites the file in place.
      fs.copyFileSync(p, backup)
    }
    console.error(`[spaces] preserved ${kind} spaces.json as ${backup}`)
  } catch (err) {
    // Best-effort — if we can't move it aside we leave it in place and still
    // start fresh in the renderer.
    console.error('[spaces] failed to preserve unusable spaces.json:', err)
  }
}

/**
 * One-time migration: if no spaces.json exists yet but a legacy flat
 * sessions.json workspace does, wrap that workspace into a single "My Work"
 * Space and make it active. The legacy file is left untouched (read-only) until
 * the renderer performs its first spaces.json write, so nothing is lost if the
 * migration is interrupted. Returns null when there is nothing to migrate.
 */
export function migrateLegacyWorkspace(): PersistedSpacesFile | null {
  const legacy = loadWorkspace()
  if (!legacy) return null
  const now = Date.now()
  return {
    version: SPACES_VERSION,
    activeSpaceId: MIGRATED_SPACE_ID,
    spaces: [
      {
        id: MIGRATED_SPACE_ID,
        name: MIGRATED_SPACE_NAME,
        color: MIGRATED_SPACE_COLOR,
        projectIds: [],
        workspace: legacy,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now
      }
    ]
  }
}

/** Load persisted spaces, migrating a legacy workspace on first run. Returns
 *  null when there is no usable file and nothing to migrate — or when an
 *  existing file is corrupt/unsupported (in which case it is preserved, not
 *  overwritten, and the renderer starts fresh in memory). */
export function loadOrMigrateSpaces(): PersistedSpacesFile | null {
  const outcome = readSpacesFile()
  if (outcome.status === 'ok') return outcome.file
  if (outcome.status === 'corrupt' || outcome.status === 'unsupported') {
    // Never migrate over or down-convert a file we can't use — move it aside so
    // nothing is silently lost, then start fresh. The next real workspace change
    // persists a clean spaces.json in its place.
    preserveUnusableSpacesFile(outcome.status)
    return null
  }
  // Genuinely absent → safe to migrate a legacy workspace (if any exists).
  const migrated = migrateLegacyWorkspace()
  if (migrated) {
    // Persist the migrated file immediately. Otherwise a workspace autosave
    // fired during the renderer's async boot could overwrite the legacy
    // sessions.json with an empty workspace before spaces.json exists,
    // losing the migration source with nothing durable to replace it.
    saveSpaces(migrated)
  }
  return migrated
}
