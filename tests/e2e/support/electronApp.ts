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

export async function launchApp(): Promise<{
  app: ElectronApplication
  window: Page
  userDataDir: string
}> {
  const repoRoot = process.cwd()
  const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js')
  const bootstrapEntry = path.join(repoRoot, 'tests', 'e2e', 'support', 'electron-entry.cjs')
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-e2e-'))

  const app = await electron.launch({
    args: [bootstrapEntry, mainEntry],
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
