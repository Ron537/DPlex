import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let tmpDir: string

// Toggle to simulate a rename-aside failure (e.g. EXDEV across filesystems) so
// the copy-fallback in preserveUnusableSpacesFile can be exercised. fs is
// otherwise the real module (spread below), so every other call is unaffected.
const fsState = vi.hoisted(() => ({ failRename: false }))

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir
  }
}))

vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>()
  return {
    ...actual,
    default: actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsState.failRename) throw new Error('EXDEV: simulated cross-device rename')
      return actual.renameSync(...args)
    }
  }
})

const loadWorkspace = vi.fn()
vi.mock('../../src/main/services/sessionPersistence', () => ({
  loadWorkspace: () => loadWorkspace()
}))

import {
  loadOrMigrateSpaces,
  loadSpaces,
  migrateLegacyWorkspace,
  saveSpaces,
  type PersistedSpacesFile
} from '../../src/main/services/spacesPersistence'

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dplex-spaces-'))
  loadWorkspace.mockReset()
  fsState.failRename = false
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function sampleFile(): PersistedSpacesFile {
  return {
    version: 1,
    activeSpaceId: 'space-1',
    spaces: [
      {
        id: 'space-1',
        name: 'Ship OAuth',
        color: '#6E8BFF',
        projectIds: ['p1', 'p2'],
        workspace: { layout: { type: 'group', groupId: 'g1' }, groups: [], activeGroupId: null },
        createdAt: 1,
        updatedAt: 2,
        lastActiveAt: 3
      }
    ]
  }
}

describe('spacesPersistence round-trip', () => {
  it('save then load returns the same file', () => {
    const file = sampleFile()
    saveSpaces(file)
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json'))).toBe(true)
    const loaded = loadSpaces()
    expect(loaded).toEqual(file)
  })

  it('load returns null when no file exists', () => {
    expect(loadSpaces()).toBeNull()
  })

  it('load returns null for a corrupted file', () => {
    fs.writeFileSync(path.join(tmpDir, 'spaces.json'), '{ not valid json')
    expect(loadSpaces()).toBeNull()
  })

  it('load rejects a structurally invalid file (bad activeSpaceId type)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'spaces.json'),
      JSON.stringify({ version: 1, spaces: [], activeSpaceId: 42 })
    )
    expect(loadSpaces()).toBeNull()
  })

  it('load rejects a file whose version is not a number', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'spaces.json'),
      JSON.stringify({ version: 'one', spaces: [], activeSpaceId: null })
    )
    expect(loadSpaces()).toBeNull()
  })

  it('load rejects a file written by a newer schema version', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'spaces.json'),
      JSON.stringify({ version: 999, spaces: [], activeSpaceId: null })
    )
    expect(loadSpaces()).toBeNull()
  })

  it('load rejects a bogus version (0, negative, or fractional)', () => {
    for (const version of [0, -1, 1.5]) {
      fs.writeFileSync(
        path.join(tmpDir, 'spaces.json'),
        JSON.stringify({ version, spaces: [], activeSpaceId: null })
      )
      expect(loadSpaces()).toBeNull()
    }
  })

  it('load rejects a file with a malformed (null) space entry', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'spaces.json'),
      JSON.stringify({ version: 1, spaces: [null], activeSpaceId: null })
    )
    expect(loadSpaces()).toBeNull()
  })

  it('load accepts a valid empty file with a null activeSpaceId', () => {
    const file = { version: 1, spaces: [], activeSpaceId: null }
    fs.writeFileSync(path.join(tmpDir, 'spaces.json'), JSON.stringify(file))
    expect(loadSpaces()).toEqual(file)
  })

  it('save writes atomically (no leftover .tmp file)', () => {
    saveSpaces(sampleFile())
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json.tmp'))).toBe(false)
  })
})

describe('migrateLegacyWorkspace', () => {
  it('wraps a legacy sessions.json workspace into a single active "My Work" space', () => {
    const legacy = {
      layout: { type: 'group', groupId: 'g1' },
      groups: [{ id: 'g1' }],
      activeGroupId: 'g1'
    }
    loadWorkspace.mockReturnValue(legacy)

    const migrated = migrateLegacyWorkspace()
    expect(migrated).not.toBeNull()
    expect(migrated!.spaces).toHaveLength(1)
    const s = migrated!.spaces[0]
    expect(s.name).toBe('My Work')
    expect(s.id).toBe('space-my-work')
    expect(s.workspace).toEqual(legacy)
    expect(migrated!.activeSpaceId).toBe('space-my-work')
  })

  it('returns null when there is no legacy workspace to migrate', () => {
    loadWorkspace.mockReturnValue(null)
    expect(migrateLegacyWorkspace()).toBeNull()
  })
})

describe('loadOrMigrateSpaces precedence', () => {
  it('prefers an existing spaces.json over legacy migration', () => {
    const file = sampleFile()
    saveSpaces(file)
    loadWorkspace.mockReturnValue({ layout: { type: 'group' }, groups: [], activeGroupId: null })

    const result = loadOrMigrateSpaces()
    expect(result).toEqual(file)
    // Existing file wins → migration path not consulted.
    expect(loadWorkspace).not.toHaveBeenCalled()
  })

  it('falls back to migration when no spaces.json exists', () => {
    const legacy = { layout: { type: 'group', groupId: 'g1' }, groups: [], activeGroupId: null }
    loadWorkspace.mockReturnValue(legacy)

    const result = loadOrMigrateSpaces()
    expect(result!.spaces[0].name).toBe('My Work')
  })

  it('persists the migrated file immediately so the migration is durable', () => {
    const legacy = { layout: { type: 'group', groupId: 'g1' }, groups: [], activeGroupId: null }
    loadWorkspace.mockReturnValue(legacy)

    const migrated = loadOrMigrateSpaces()
    // spaces.json must exist on disk right after migration — otherwise a
    // mid-boot workspace autosave could clobber the legacy source first.
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json'))).toBe(true)

    // And a fresh load returns the same migrated data without re-migrating.
    loadWorkspace.mockClear()
    const reloaded = loadOrMigrateSpaces()
    expect(reloaded).toEqual(migrated)
    expect(loadWorkspace).not.toHaveBeenCalled()
  })

  it('returns null when there is neither a spaces file nor a legacy workspace', () => {
    loadWorkspace.mockReturnValue(null)
    expect(loadOrMigrateSpaces()).toBeNull()
  })
})

describe('loadOrMigrateSpaces preserves unusable files', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  function backups(suffix: string): string[] {
    return fs.readdirSync(tmpDir).filter((f) => f.startsWith(`spaces.json.${suffix}-`))
  }

  it('moves a corrupt file aside and does NOT migrate over it', () => {
    fs.writeFileSync(path.join(tmpDir, 'spaces.json'), '{ not valid json')
    loadWorkspace.mockReturnValue({ layout: { type: 'group' }, groups: [], activeGroupId: null })

    const result = loadOrMigrateSpaces()

    expect(result).toBeNull()
    // Never wraps the legacy workspace over an existing (if unreadable) file.
    expect(loadWorkspace).not.toHaveBeenCalled()
    // The bad file is preserved as a timestamped backup, and no fresh
    // spaces.json is written in its place (the renderer seeds in memory).
    expect(backups('corrupt')).toHaveLength(1)
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json'))).toBe(false)
  })

  it('moves a newer-schema file aside as an .unsupported backup', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'spaces.json'),
      JSON.stringify({ version: 999, spaces: [], activeSpaceId: null })
    )
    loadWorkspace.mockReturnValue({ layout: { type: 'group' }, groups: [], activeGroupId: null })

    const result = loadOrMigrateSpaces()

    expect(result).toBeNull()
    expect(loadWorkspace).not.toHaveBeenCalled()
    expect(backups('unsupported')).toHaveLength(1)
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json'))).toBe(false)
  })

  it('falls back to copying the backup when the rename-aside fails', () => {
    fs.writeFileSync(path.join(tmpDir, 'spaces.json'), '{ not valid json')
    loadWorkspace.mockReturnValue({ layout: { type: 'group' }, groups: [], activeGroupId: null })
    fsState.failRename = true

    const result = loadOrMigrateSpaces()

    expect(result).toBeNull()
    expect(loadWorkspace).not.toHaveBeenCalled()
    const bak = backups('corrupt')
    expect(bak).toHaveLength(1)
    // Copy (not rename) fallback → the original file remains in place AND the
    // backup holds its bytes, so the data survives the next save that overwrites
    // spaces.json.
    expect(fs.existsSync(path.join(tmpDir, 'spaces.json'))).toBe(true)
    expect(fs.readFileSync(path.join(tmpDir, bak[0]), 'utf-8')).toBe('{ not valid json')
  })

  it('returns a valid empty file as-is without migrating or reseeding', () => {
    const empty = { version: 1, spaces: [], activeSpaceId: null }
    fs.writeFileSync(path.join(tmpDir, 'spaces.json'), JSON.stringify(empty))
    loadWorkspace.mockReturnValue({ layout: { type: 'group' }, groups: [], activeGroupId: null })

    const result = loadOrMigrateSpaces()

    // An empty-but-valid file means the user deleted all spaces — honour it,
    // don't treat it as a fresh install and re-migrate a legacy workspace.
    expect(result).toEqual(empty)
    expect(loadWorkspace).not.toHaveBeenCalled()
  })
})
