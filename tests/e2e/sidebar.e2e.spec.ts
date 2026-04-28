import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'

// Seed the renderer-side projects list via the settings IPC, then reload the
// window so the project store picks them up on mount. This lets us exercise
// project-related UI (last-expanded highlighting, chevron vs card click) in
// e2e without needing the OS folder picker.
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
  // Wait for the first seeded project to appear so subsequent assertions
  // don't race against the store's async load.
  if (projects[0]) {
    await window.getByText(projects[0].name).waitFor({ state: 'visible' })
  }
}

test.describe('DPlex sidebar interactions', () => {
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

  test('Cmd/Ctrl+F focuses the panel search input', async () => {
    if (!window) throw new Error('Window not available')

    const search = window.getByPlaceholder('Search projects...')
    await expect(search).toBeVisible()

    // Move focus away from the search input by focusing the body.
    await window.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      active?.blur()
      document.body.setAttribute('tabindex', '-1')
      ;(document.body as HTMLElement).focus()
    })
    await expect(search).not.toBeFocused()

    await window.keyboard.press('ControlOrMeta+f')
    await expect(search).toBeFocused()
  })

  test('Cmd/Ctrl+F uncollapses the panel before focusing search', async () => {
    if (!window) throw new Error('Window not available')

    // Ensure the panel is rendered first.
    await expect(window.getByPlaceholder('Search projects...')).toBeVisible()

    // Collapse via the status-bar toggle — deterministic on every platform
    // (the keyboard shortcut path is covered elsewhere).
    await window.getByTitle(/Hide panel/).click()
    await expect(window.getByPlaceholder('Search projects...')).not.toBeVisible()

    // Cmd+F should uncollapse the panel and focus the now-visible input.
    await window.keyboard.press('ControlOrMeta+f')
    const search = window.getByPlaceholder('Search projects...')
    await expect(search).toBeVisible()
    await expect(search).toBeFocused()
  })

  test('clicking an expanded, non-emphasized project promotes it; chevron still collapses', async () => {
    if (!window) throw new Error('Window not available')

    await seedProjects(window, [
      { id: 'proj-alpha-e2e', name: 'Alpha E2E', path: '/tmp/dplex-e2e-alpha' },
      { id: 'proj-beta-e2e', name: 'Beta E2E', path: '/tmp/dplex-e2e-beta' }
    ])

    const alphaRow = window.locator('div.group').filter({ hasText: 'Alpha E2E' })
    const betaRow = window.locator('div.group').filter({ hasText: 'Beta E2E' })
    await expect(alphaRow).toHaveCount(1)
    await expect(betaRow).toHaveCount(1)

    // Expand Alpha first, then Beta — Beta becomes the emphasized one.
    await alphaRow.click()
    await expect(window.getByRole('button', { name: 'Collapse project' })).toHaveCount(1)
    await betaRow.click()
    await expect(window.getByRole('button', { name: 'Collapse project' })).toHaveCount(2)

    // Clicking Alpha (already expanded, not emphasized) should promote it —
    // both projects should remain expanded.
    await alphaRow.click()
    await expect(window.getByRole('button', { name: 'Collapse project' })).toHaveCount(2)
    await expect(window.getByRole('button', { name: 'Expand project' })).toHaveCount(0)

    // Now click the chevron on Alpha's row directly — this should collapse it.
    // The chevron hides on hover in favor of action buttons; dispatch a click
    // event directly at the DOM element to bypass the hover swap.
    await alphaRow.getByRole('button', { name: 'Collapse project' }).dispatchEvent('click')
    await expect(window.getByRole('button', { name: 'Collapse project' })).toHaveCount(1)
    await expect(window.getByRole('button', { name: 'Expand project' })).toHaveCount(1)
  })
})
