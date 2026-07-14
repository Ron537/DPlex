import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'

function createTestEnv(userDataDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DPLEX_E2E: '1'
  }

  if (process.platform === 'win32') {
    env.HOME = userDataDir
    env.USERPROFILE = userDataDir
    env.APPDATA = userDataDir
    env.LOCALAPPDATA = userDataDir
    env.TEMP = userDataDir
    env.TMP = userDataDir
    return env
  }

  env.XDG_CONFIG_HOME = userDataDir
  env.XDG_DATA_HOME = userDataDir
  env.XDG_STATE_HOME = userDataDir
  env.HOME = userDataDir
  return env
}

export async function launchApp(opts?: {
  settings?: Record<string, unknown>
  spaces?: Record<string, unknown>
}): Promise<{
  app: ElectronApplication
  window: Page
  userDataDir: string
}> {
  const repoRoot = process.cwd()
  const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js')
  const bootstrapEntry = path.join(repoRoot, 'tests', 'e2e', 'support', 'electron-entry.cjs')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-e2e-'))

  // Seed a deterministic settings file so the panel is guaranteed to start
  // uncollapsed and visible regardless of any previous local state. Electron
  // resolves `app.getPath('userData')` under the HOME we override below, but
  // the precise sub-path differs per-platform — writing the file alongside
  // a fallback copy here keeps tests deterministic.
  const seedSettings = {
    sidebarVisible: true,
    sidebarPanelCollapsed: false,
    sidebarActiveTab: 'projects',
    ...(opts?.settings ?? {})
  }
  // With --user-data-dir=<userDataDir>, Electron's app.getPath('userData')
  // points directly at userDataDir (no extra {AppName} subdirectory). Seed
  // settings.json there so the app starts with a known state.
  try {
    await fs.writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify(seedSettings))
  } catch {
    // Best-effort; continue even if seeding fails.
  }

  // Optionally seed spaces.json so the app boots straight into a known Spaces
  // state (e.g. the Overview with a set of background spaces). Written to the
  // same userData location as settings.json above.
  if (opts?.spaces) {
    try {
      await fs.writeFile(path.join(userDataDir, 'spaces.json'), JSON.stringify(opts.spaces))
    } catch {
      // Best-effort; continue even if seeding fails.
    }
  }

  const app = await electron.launch({
    args: [bootstrapEntry, mainEntry, `--user-data-dir=${userDataDir}`],
    env: createTestEnv(userDataDir)
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return { app, window, userDataDir }
}

export async function closeApp(app?: ElectronApplication, userDataDir?: string): Promise<void> {
  if (app) {
    await app.close()
  }
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}
