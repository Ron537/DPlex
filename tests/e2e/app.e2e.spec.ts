import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './support/electronApp'
import { expectSolidContrast } from './support/contrast'
import type { AISession, Project } from '../../src/renderer/src/types'

test.describe('DPlex Electron app', () => {
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

  test('renders main layout and status controls', async () => {
    if (!window) throw new Error('Window not available')
    await expect(window.getByText('DPlex')).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Projects' })).toBeVisible()
    await expect(window.getByPlaceholder('Search projects...')).toBeVisible()
    await expect(window.getByText(/terminals? · \d+ groups?/)).toBeVisible()
  })

  test('opens settings and navigates tabs', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTitle('Settings', { exact: true }).click()
    // After the visual refresh the modal opens directly into the
    // Appearance tab — no longer a "Settings" wordmark in the header.
    await expect(window.getByRole('heading', { name: 'Appearance' })).toBeVisible()

    await window.getByRole('button', { name: 'Notifications' }).click()
    await expect(window.getByText('Enable notifications')).toBeVisible()

    await window.getByRole('button', { name: 'Shortcuts' }).click()
    // The Shortcuts pane has a "General" section heading rendered as <h4>;
    // disambiguate from the left-rail "General" group label (<h3>).
    await expect(window.locator('h4').filter({ hasText: 'General' })).toBeVisible()

    await window.keyboard.press('Escape')
    await expect(window.getByText('Enable notifications')).toHaveCount(0)
  })

  test('titlebar search opens the palette and compact chrome remains reachable', async () => {
    if (!window || !app) throw new Error('Window not available')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 500))
    const search = window.getByTestId('titlebar-search')
    await expect(search).toBeInViewport()
    await search.click()
    await expect(window.getByTestId('command-palette-input')).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(search).toBeFocused()
    await expect(window.getByTestId('activity-bar-settings')).toBeInViewport()
    await expect(window.getByTestId('activity-bar-dashboard')).toBeInViewport()
    await window.getByTestId('activity-bar-settings').click()
    await expect(window.getByRole('heading', { name: 'Appearance' })).toBeVisible()
  })

  test('settings stay usable in a small window with readable dark and light controls', async () => {
    if (!window || !app) throw new Error('Window not available')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 560))
    await window.getByTestId('activity-bar-settings').click()
    const modal = window.getByTestId('settings-modal')
    const panel = modal.locator(':scope > div')

    for (const theme of ['DPlex', 'DPlex Light']) {
      const tile = modal.getByRole('button', { name: theme, exact: true })
      await tile.click()
      await expect(tile).toHaveAttribute('aria-pressed', 'true')
      await expect
        .poll(() => window!.evaluate(() => document.documentElement.style.colorScheme))
        .toBe(theme === 'DPlex' ? 'dark' : 'light')

      const bounds = await panel.boundingBox()
      const viewport = await window.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(20)
      expect(bounds!.y).toBeGreaterThanOrEqual(20)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 20)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 20)
      const overflow = await panel.evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(overflow).toBe(false)
      await expect(modal.getByRole('button', { name: 'Done', exact: true })).toBeInViewport()
      await expect(modal.getByRole('button', { name: 'Close settings' })).toBeInViewport()

      await window.screenshot({
        path: test.info().outputPath(`settings-${theme.replace(' ', '-')}.png`),
        animations: 'disabled'
      })
      await expectSolidContrast(modal.getByRole('button', { name: 'Done', exact: true }))
    }

    await modal.getByRole('button', { name: 'Terminal', exact: true }).click()
    await expect(modal.getByText('Default Shell', { exact: true })).toBeVisible()
    await modal.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(modal).not.toBeVisible()
  })

  test('bundled UI font loads offline without changing the terminal font', async () => {
    if (!window) throw new Error('Window not available')
    await expect(window.locator('.xterm-rows').first()).toBeVisible()
    const fonts = await window.evaluate(async () => {
      await document.fonts.ready
      return {
        bundled: [...document.fonts].some(
          (font) => font.family === 'IBM Plex Sans' && font.status === 'loaded'
        ),
        ui: getComputedStyle(document.body).fontFamily,
        terminal: getComputedStyle(document.querySelector('.xterm-rows')!).fontFamily
      }
    })
    expect(fonts.bundled).toBe(true)
    expect(fonts.ui).toContain('IBM Plex Sans')
    expect(fonts.terminal).not.toContain('IBM Plex Sans')
  })

  test('creates a terminal and splits groups', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTitle('New terminal (default shell)').click()
    await expect(window.getByText(/2 terminals? · 1 groups?/)).toBeVisible()

    const splitButtonsBefore = await window.getByTitle('Split right').count()
    await window.getByTitle('Split right').first().click()
    await expect(window.getByTitle('Split right')).toHaveCount(splitButtonsBefore + 1)
  })

  test('mouse wheel reaches overflowing tab pills without requiring a trackpad', async () => {
    if (!window || !app) throw new Error('Window not available')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 720))
    for (let i = 0; i < 5; i++) {
      await window.getByTitle('New terminal (default shell)').click()
    }
    const labels = window.getByTestId('editor-tab-label')
    await expect(labels).toHaveCount(6)
    const strip = window.locator('.dplex-tab-scroll')
    expect(await strip.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
      await strip.evaluate((el) => el.clientWidth)
    )
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    await strip.hover()
    await window.mouse.wheel(0, 1200)
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    const report = await labels.last().evaluate((el) => {
      const pill = el.parentElement!
      const strip = pill.parentElement!
      const pillBox = pill.getBoundingClientRect()
      const stripBox = strip.getBoundingClientRect()
      return { right: pillBox.right, availableRight: stripBox.right }
    })
    expect(report.right).toBeLessThanOrEqual(report.availableRight)
    await labels.last().click()
    await expect(labels.last()).toBeVisible()
  })

  test('accent-filled actions retain a visible external keyboard focus ring', async () => {
    if (!window) throw new Error('Window not available')
    await window.getByTestId('space-switcher-overview').click()
    await window.getByTestId('overview-new-space').click()
    await window.getByPlaceholder('e.g. Ship OAuth, Fix flaky tests, Perf pass').fill('Focus check')
    const action = window.getByTestId('space-modal-save')
    await expect(action).toBeEnabled()
    await window.keyboard.press('Tab')
    await action.focus()
    await expect(action).toHaveCSS('outline-style', 'solid')
    const offset = await action.evaluate((el) => parseFloat(getComputedStyle(el).outlineOffset))
    expect(offset).toBeGreaterThan(0)
  })

  test('space and external-session confirmations have readable accent fills in both themes', async () => {
    if (!window || !userDataDir) throw new Error('Window not available')
    await window.evaluate(() => localStorage.setItem('dplex-demo', '1'))
    await window.reload()
    await window.getByTestId('space-switcher-overview').click()

    for (const theme of ['DPlex', 'DPlex Light']) {
      await window.getByTestId('activity-bar-settings').click()
      const settings = window.getByTestId('settings-modal')
      await settings.getByRole('button', { name: theme, exact: true }).click()
      await settings.getByRole('button', { name: 'Done', exact: true }).click()
      await window.evaluate((cwd) => {
        const demo = (
          window as unknown as {
            __dplex: {
              projectStore: { setState: (state: { projects: Project[] }) => void }
              sessionStore: {
                setState: (state: { sessions: AISession[]; loading: boolean }) => void
              }
            }
          }
        ).__dplex
        demo.projectStore.setState({
          projects: [
            {
              id: 'contrast-project',
              name: 'Contrast project',
              path: cwd,
              addedAt: new Date().toISOString()
            }
          ]
        })
        demo.sessionStore.setState({
          loading: false,
          sessions: [
            {
              id: 'contrast-session',
              aiTool: 'copilot-cli',
              displayName: 'Contrast external session',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
              messageCount: 2,
              cwd
            }
          ]
        })
      }, userDataDir)

      await window.getByTestId('overview-new-space').click()
      await window
        .getByPlaceholder('e.g. Ship OAuth, Fix flaky tests, Perf pass')
        .fill('Contrast space')
      const project = window.getByRole('button', { name: 'Contrast project', exact: true })
      await project.click()
      await expect(project).toHaveAttribute('aria-selected', 'true')
      await expectSolidContrast(project.locator(':scope > span').first(), 3)
      await expectSolidContrast(window.getByTestId('space-modal-save'))
      await window.getByRole('button', { name: 'Cancel', exact: true }).click()

      await window.getByTestId('titlebar-search').click()
      await window.getByTestId('command-palette-input').fill('Contrast external session')
      await window
        .getByTestId('search-result')
        .filter({ hasText: 'Contrast external session' })
        .click()
      await expectSolidContrast(window.getByTestId('external-resume-confirm'))
      await window
        .getByRole('dialog', { name: 'Resume a session running outside DPlex?' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
    }
  })
})
