import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { closeApp, launchApp } from './support/electronApp'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * Scenario injected into the renderer stores via the demo hatch
 * (`localStorage['dplex-demo'] === '1'`, see src/renderer/src/main.tsx). Using
 * the real stores + real UI keeps these tests platform-independent — no PTY
 * commands or persisted-workspace shape coupling.
 */
interface FocusScenario {
  projects: Array<{ id: string; name: string; path: string }>
  groups: Array<{
    id: string
    activeTabId: string
    tabs: Array<{ id: string; title: string; cwd: string }>
  }>
  layout: unknown
  activeGroupId: string
  activeProjectId: string
}

/**
 * Turn on the store hatch and reload so main.tsx re-runs and exposes
 * `window.__dplex`. Returns once the app has re-rendered.
 */
async function enableStoreHatch(window: Page): Promise<void> {
  await window.evaluate(() => window.localStorage.setItem('dplex-demo', '1'))
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  // Wait for the default terminal the app auto-creates on a fresh workspace, so
  // our injection replaces a settled state rather than racing the restore.
  await expect(window.getByText(/\d+ terminals? · \d+ groups?/)).toBeVisible({ timeout: 15_000 })
  await window.waitForFunction(
    () => Boolean((window as unknown as { __dplex?: unknown }).__dplex),
    {
      timeout: 15_000
    }
  )
}

/** Inject the projects + terminal groups straight into the live stores. */
async function injectScenario(window: Page, scenario: FocusScenario): Promise<void> {
  await window.evaluate((s) => {
    const dplex = (
      window as unknown as {
        __dplex: {
          projectStore: { setState: (partial: unknown) => void }
          terminalStore: { setState: (partial: unknown) => void }
        }
      }
    ).__dplex
    dplex.projectStore.setState({
      projects: s.projects.map((p) => ({
        ...p,
        addedAt: new Date().toISOString(),
        pinned: false
      })),
      activeProjectId: s.activeProjectId
    })
    dplex.terminalStore.setState({
      groups: s.groups.map((g) => ({
        id: g.id,
        activeTabId: g.activeTabId,
        tabs: g.tabs.map((t) => ({ id: t.id, title: t.title, kind: 'terminal', cwd: t.cwd }))
      })),
      layout: s.layout,
      activeGroupId: s.activeGroupId,
      restored: true
    })
  }, scenario)
}

/** Count of currently rendered editor tabs (tab-bar labels). */
function tabLabels(window: Page): ReturnType<Page['getByTestId']> {
  return window.getByTestId('editor-tab-label')
}

/** The tab-bar label for a specific tab title (scoped to the tab strip, so it
 *  doesn't collide with the TabHeader breadcrumb / terminal title). */
function tabLabel(window: Page, title: string): ReturnType<Page['getByTestId']> {
  return window.getByTestId('editor-tab-label').filter({ hasText: title })
}

/** Number of rendered groups (each group's tab bar has one "Split right"). */
function groupCount(window: Page): Promise<number> {
  return window.getByTitle('Split right').count()
}

test.describe('DPlex project focus', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined
  let projA: string | undefined
  let projB: string | undefined

  async function launch(settings?: Record<string, unknown>): Promise<Page> {
    const launched = await launchApp({ settings })
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
    return window
  }

  test.beforeEach(async () => {
    projA = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-focus-a-'))
    projB = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-focus-b-'))
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
    app = undefined
    userDataDir = undefined
    for (const dir of [projA, projB]) {
      if (dir) await fs.rm(dir, { recursive: true, force: true })
    }
    projA = undefined
    projB = undefined
  })

  /** Build a single-group two-project scenario (tab-A active). */
  function singleGroupScenario(): FocusScenario {
    return {
      projects: [
        { id: 'pa', name: 'projA', path: projA! },
        { id: 'pb', name: 'projB', path: projB! }
      ],
      groups: [
        {
          id: 'g1',
          activeTabId: 't-a',
          tabs: [
            { id: 't-a', title: 'tab-A', cwd: projA! },
            { id: 't-b', title: 'tab-B', cwd: projB! }
          ]
        }
      ],
      layout: { type: 'group', groupId: 'g1' },
      activeGroupId: 'g1',
      activeProjectId: 'pa'
    }
  }

  test('isolate mode shows only the active project tabs and restores on clear', async () => {
    const win = await launch({ focusFilterMode: 'isolate' })
    await enableStoreHatch(win)
    await injectScenario(win, singleGroupScenario())

    // Both tabs visible before focusing.
    await expect(tabLabels(win)).toHaveCount(2)
    await expect(tabLabel(win, 'tab-A')).toBeVisible()
    await expect(tabLabel(win, 'tab-B')).toBeVisible()

    // Turn focus on — isolate hides the non-matching tab.
    await win.getByLabel('Focus active project').click()
    await expect(tabLabels(win)).toHaveCount(1)
    await expect(tabLabel(win, 'tab-A')).toBeVisible()
    await expect(tabLabel(win, 'tab-B')).toHaveCount(0)

    // The focus pill shows the focused project + a clear action.
    await expect(win.getByLabel('Clear focus')).toBeVisible()

    // Clearing focus restores the full, unfiltered view.
    await win.getByLabel('Clear focus').click()
    await expect(tabLabels(win)).toHaveCount(2)
    await expect(tabLabel(win, 'tab-B')).toBeVisible()
  })

  test('dim mode keeps every tab visible but de-emphasizes the others', async () => {
    const win = await launch({ focusFilterMode: 'dim' })
    await enableStoreHatch(win)
    await injectScenario(win, singleGroupScenario())

    await win.getByLabel('Focus active project').click()

    // Dim never hides tabs — both remain in the DOM.
    await expect(tabLabels(win)).toHaveCount(2)
    await expect(tabLabel(win, 'tab-B')).toBeVisible()

    // The non-matching tab is rendered de-emphasized (reduced opacity).
    const dimmedOpacity = await tabLabel(win, 'tab-B')
      .locator('xpath=ancestor::div[contains(@class,"group")][1]')
      .evaluate((el) => getComputedStyle(el).opacity)
    expect(Number(dimmedOpacity)).toBeLessThan(1)
  })

  test('isolate follows the active project when another project is selected', async () => {
    const win = await launch({ focusFilterMode: 'isolate' })
    await enableStoreHatch(win)
    await injectScenario(win, singleGroupScenario())

    await win.getByLabel('Focus active project').click()
    await expect(tabLabel(win, 'tab-A')).toBeVisible()
    await expect(tabLabel(win, 'tab-B')).toHaveCount(0)

    // Selecting project B in the sidebar re-targets isolation to B.
    await win.getByText('projB').click()
    await expect(tabLabel(win, 'tab-B')).toBeVisible()
    await expect(tabLabel(win, 'tab-A')).toHaveCount(0)
  })

  test('isolate collapses split groups that have no matching tab', async () => {
    const win = await launch({ focusFilterMode: 'isolate' })
    await enableStoreHatch(win)
    await injectScenario(win, {
      projects: [
        { id: 'pa', name: 'projA', path: projA! },
        { id: 'pb', name: 'projB', path: projB! }
      ],
      groups: [
        { id: 'g1', activeTabId: 't-a', tabs: [{ id: 't-a', title: 'tab-A', cwd: projA! }] },
        { id: 'g2', activeTabId: 't-b', tabs: [{ id: 't-b', title: 'tab-B', cwd: projB! }] }
      ],
      layout: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'group', groupId: 'g1' },
          { type: 'group', groupId: 'g2' }
        ]
      },
      activeGroupId: 'g1',
      activeProjectId: 'pa'
    })

    // Two groups rendered before focus.
    expect(await groupCount(win)).toBe(2)

    // Isolating projA collapses the projB-only group.
    await win.getByLabel('Focus active project').click()
    await expect(tabLabel(win, 'tab-A')).toBeVisible()
    await expect(tabLabel(win, 'tab-B')).toHaveCount(0)
    expect(await groupCount(win)).toBe(1)

    // Clearing focus brings the second group back.
    await win.getByLabel('Clear focus').click()
    expect(await groupCount(win)).toBe(2)
  })

  test('Cmd/Ctrl+Shift+O toggles focus on and off', async () => {
    const win = await launch({ focusFilterMode: 'isolate' })
    await enableStoreHatch(win)
    await injectScenario(win, singleGroupScenario())

    await win.keyboard.press(`${MOD}+Shift+O`)
    await expect(win.getByLabel('Clear focus')).toBeVisible()
    await expect(tabLabels(win)).toHaveCount(1)

    await win.keyboard.press(`${MOD}+Shift+O`)
    await expect(win.getByLabel('Clear focus')).toHaveCount(0)
    await expect(tabLabels(win)).toHaveCount(2)
  })

  test('switching the style switch between Dim and Isolate re-renders immediately', async () => {
    const win = await launch({ focusFilterMode: 'dim' })
    await enableStoreHatch(win)
    await injectScenario(win, singleGroupScenario())

    // Focus on in dim mode — both tabs stay visible.
    await win.getByLabel('Focus active project').click()
    await expect(tabLabels(win)).toHaveCount(2)

    // Flip to Isolate via the inline switch — the other tab is hidden at once.
    await win.getByRole('button', { name: 'Isolate' }).click()
    await expect(tabLabels(win)).toHaveCount(1)
    await expect(tabLabel(win, 'tab-B')).toHaveCount(0)

    // Flip back to Dim — the tab returns.
    await win.getByRole('button', { name: 'Dim' }).click()
    await expect(tabLabels(win)).toHaveCount(2)
    await expect(tabLabel(win, 'tab-B')).toBeVisible()
  })
})
