import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

async function seedProjects(
  window: Page,
  projects: Array<{ id: string; name: string; path: string }>
): Promise<void> {
  await window.evaluate(async (payload) => {
    const withMeta = payload.map((p) => ({
      ...p,
      addedAt: new Date().toISOString(),
      pinned: false
    }))
    // @ts-expect-error: dplex is defined on the renderer window via preload
    await window.dplex.settings.merge({ projects: withMeta })
  }, projects)
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  if (projects[0]) {
    await window.getByText(projects[0].name).waitFor({ state: 'visible' })
  }
}

test.describe('DPlex global search', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined

  test.beforeEach(async () => {
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
  })

  test('Cmd/Ctrl+P opens the command palette and shows results', async () => {
    if (!window || !app) throw new Error('App not available')

    await seedProjects(window, [
      { id: 'gs-alpha', name: 'GlobalSearchAlpha', path: '/tmp/dplex-gs-alpha' }
    ])

    await window.getByTestId('activity-bar-search').waitFor({ state: 'visible' })

    // We test the renderer wiring via the same IPC the production
    // `globalShortcut` registration sends. Playwright's `keyboard.press`
    // can't reliably trigger Cmd/Ctrl+P on Linux Electron — Chromium's
    // print-preview accelerator intercepts the synthesized CDP event
    // before any renderer keydown listener fires, and `globalShortcut`
    // only fires for native input. The `dplex:shortcut` IPC is exactly
    // what the OS-level accelerator dispatches in production, so this
    // assertion still covers the renderer's open-palette path end-to-end.
    await app.evaluate(({ BrowserWindow: BW }) => {
      const win = BW.getAllWindows()[0]
      win?.webContents.send('dplex:shortcut', 'palette.all')
    })

    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()

    const input = window.getByTestId('command-palette-input')
    await expect(input).toBeFocused()

    await input.fill('GlobalSearchAlpha')
    const results = window.getByTestId('search-result')
    await expect(results.first()).toBeVisible()
    await expect(results.first()).toContainText('GlobalSearchAlpha')
  })

  test('Cmd/Ctrl+Shift+P opens the palette in commands-only mode', async () => {
    if (!window) throw new Error('Window not available')

    await window.getByTestId('activity-bar-search').waitFor({ state: 'visible' })
    await window.keyboard.press('ControlOrMeta+Shift+p')

    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    // The command-only badge confirms the mode.
    await expect(palette).toContainText('Commands')

    // Type a fragment of a command to confirm filtering, then dismiss with Esc.
    await window.getByTestId('command-palette-input').fill('toggle sidebar')
    const results = window.getByTestId('search-result')
    await expect(results.first()).toContainText('Toggle Sidebar')
    await window.keyboard.press('Escape')
    await expect(palette).not.toBeVisible()
  })

  test('Show Explorer command reveals the file explorer panel', async () => {
    if (!window) throw new Error('Window not available')

    await window.getByTestId('activity-bar-search').waitFor({ state: 'visible' })
    await window.keyboard.press('ControlOrMeta+Shift+p')

    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()

    await window.getByTestId('command-palette-input').fill('show explorer')
    const results = window.getByTestId('search-result')
    await expect(results.first()).toContainText('Show Explorer')

    await results.first().click()
    await expect(palette).not.toBeVisible()
    await expect(window.getByTestId('explorer-side-panel-view')).toBeVisible({ timeout: 5_000 })
  })

  test('Search activity-bar tab reveals the global search side panel', async () => {
    if (!window) throw new Error('Window not available')

    await seedProjects(window, [
      { id: 'gs-side-1', name: 'SidePanelHit', path: '/tmp/dplex-gs-side-1' }
    ])

    await window.getByTestId('activity-bar-search').click()

    const sideInput = window.getByTestId('search-side-input')
    await expect(sideInput).toBeVisible()
    await expect(sideInput).toBeFocused()

    await sideInput.fill('SidePanelHit')
    const results = window.getByTestId('search-result')
    await expect(results.first()).toContainText('SidePanelHit')
  })

  test('Selecting a settings result opens Settings on the right tab', async () => {
    if (!window || !app) throw new Error('App not available')

    await window.getByTestId('activity-bar-search').waitFor({ state: 'visible' })
    // Open the palette via the production `dplex:shortcut` IPC — see the
    // first test for the rationale (Playwright can't reliably synthesize
    // Cmd/Ctrl+P on Linux Electron).
    await app.evaluate(({ BrowserWindow: BW }) => {
      const win = BW.getAllWindows()[0]
      win?.webContents.send('dplex:shortcut', 'palette.all')
    })
    await window.getByTestId('command-palette-input').fill('font size')
    await expect(window.getByTestId('search-result').first()).toContainText('Font Size')
    await window.keyboard.press('Enter')

    // Settings modal opens with Terminal tab active and the row pulses.
    const modal = window.getByTestId('settings-modal')
    await expect(modal).toBeVisible()
    const fontRow = modal.locator('[data-setting-id="font-size"]')
    await expect(fontRow).toBeVisible()
  })
})
