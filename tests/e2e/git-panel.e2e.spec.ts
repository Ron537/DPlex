import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { execFileSync } from 'child_process'
import { closeApp, launchApp } from './support/electronApp'

async function makeRepoWithChange(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-gitpanel-e2e-'))
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' })
  }
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'e2e@dplex.test'])
  run(['config', 'user.name', 'E2E'])
  run(['config', 'commit.gpgsign', 'false'])
  await fs.writeFile(path.join(repoRoot, 'README.md'), 'hello\n')
  run(['add', 'README.md'])
  run(['commit', '-m', 'init'])
  // Modify so there's an unstaged change for the panel.
  await fs.writeFile(path.join(repoRoot, 'README.md'), 'hello\nworld\n')
  return repoRoot
}

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

test.describe('DPlex Git panel', () => {
  let app: ElectronApplication | undefined
  let window: Page | undefined
  let userDataDir: string | undefined
  let repoPath: string | undefined

  test.beforeEach(async () => {
    repoPath = await makeRepoWithChange()
    const launched = await launchApp()
    app = launched.app
    window = launched.window
    userDataDir = launched.userDataDir
  })

  test.afterEach(async () => {
    await closeApp(app, userDataDir)
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true })
    }
  })

  test('selecting a project opens a preview tab and double-click promotes it', async () => {
    if (!window || !repoPath) throw new Error('Window/repo not available')

    await seedProjects(window, [{ id: 'p-git-e2e', name: 'gitpanel-repo', path: repoPath }])

    // Click the project to bind it as active.
    await window.getByText('gitpanel-repo').click()

    // Open the Source Control activity-bar item.
    await window.getByTestId('activity-bar-git').click()
    await expect(window.getByTestId('git-side-panel-view')).toBeVisible({ timeout: 5_000 })

    // The changes section is rendered with at least one entry.
    await expect(window.getByTestId('git-panel-changes-section')).toBeVisible()
    const readme = window.locator('[data-git-path="README.md"]').first()
    await expect(readme).toBeVisible({ timeout: 10_000 })

    // Single-click opens a preview tab (italic title).
    await readme.click()
    const previewTab = window
      .getByTestId('editor-tab-label')
      .filter({ hasText: 'README.md' })
      .first()
    await expect(previewTab).toBeVisible({ timeout: 10_000 })
    await expect(previewTab).toHaveCSS('font-style', 'italic')

    // Double-click promotes preview → permanent (italic disappears).
    await readme.dblclick()
    await expect(previewTab).toHaveCSS('font-style', 'normal', { timeout: 5_000 })
  })

  test('Cmd/Ctrl+Shift+G toggles the Source Control view', async () => {
    if (!window || !repoPath) throw new Error('Window/repo not available')

    await seedProjects(window, [{ id: 'p-shortcut', name: 'shortcut-repo', path: repoPath }])
    await window.getByText('shortcut-repo').click()

    // Default sidebar view is Projects — Source Control view is not mounted.
    await expect(window.getByTestId('git-side-panel-view')).toHaveCount(0)

    const isMac = process.platform === 'darwin'
    const mod = isMac ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+Shift+G`)
    await expect(window.getByTestId('git-side-panel-view')).toBeVisible({ timeout: 5_000 })

    // Pressing again collapses the panel (VSCode default).
    await window.keyboard.press(`${mod}+Shift+G`)
    await expect(window.getByTestId('git-side-panel-view')).toHaveCount(0, { timeout: 5_000 })
  })

  test('shows the not-a-repo empty state for non-git folders', async () => {
    if (!window) throw new Error('Window not available')

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-not-a-repo-e2e-'))
    try {
      await seedProjects(window, [{ id: 'p-not-repo', name: 'not-a-repo', path: tmp }])
      await window.getByText('not-a-repo').click()
      await window.getByTestId('activity-bar-git').click()
      const empty = window.getByTestId('git-panel-empty-state')
      await expect(empty).toBeVisible({ timeout: 10_000 })
      await expect(empty).toHaveAttribute('data-kind', 'not-a-repo')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  test('graph section lists commits, expands files, and opens a commit diff', async () => {
    if (!window || !repoPath) throw new Error('Window/repo not available')

    await seedProjects(window, [{ id: 'p-graph-e2e', name: 'graph-repo', path: repoPath }])
    await window.getByText('graph-repo').click()
    await window.getByTestId('activity-bar-git').click()
    await expect(window.getByTestId('git-side-panel-view')).toBeVisible({ timeout: 5_000 })

    // The Graph section is collapsed by default — expand it.
    const graphSection = window.getByTestId('git-panel-graph-section')
    await expect(graphSection).toBeVisible()
    await graphSection.getByRole('button').first().click()

    // The init commit appears as a row in the graph.
    const graph = window.getByTestId('commit-graph')
    await expect(graph).toBeVisible({ timeout: 10_000 })
    const commitRow = window.getByTestId('commit-row').first()
    await expect(commitRow).toBeVisible({ timeout: 10_000 })

    // Expanding the commit reveals its changed files (README.md, added).
    await commitRow.click()
    const fileInCommit = graph.locator('[data-git-path="README.md"]').first()
    await expect(fileInCommit).toBeVisible({ timeout: 10_000 })

    // Clicking the file opens a diff tab for that commit.
    await fileInCommit.click()
    const diffTab = window
      .getByTestId('editor-tab-label')
      .filter({ hasText: 'README.md' })
      .first()
    await expect(diffTab).toBeVisible({ timeout: 10_000 })
  })

  test('shows a resizable sash when both Changes and Graph are expanded', async () => {
    if (!window || !repoPath) throw new Error('Window/repo not available')

    await seedProjects(window, [{ id: 'p-sash-e2e', name: 'sash-repo', path: repoPath }])
    await window.getByText('sash-repo').click()
    await window.getByTestId('activity-bar-git').click()
    await expect(window.getByTestId('git-side-panel-view')).toBeVisible({ timeout: 5_000 })

    // Changes is expanded by default; Graph is collapsed → no sash yet.
    await expect(window.getByTestId('git-panel-sash')).toHaveCount(0)

    // Expand Graph → both panes open → the resize sash appears.
    const graphSection = window.getByTestId('git-panel-graph-section')
    await graphSection.getByRole('button').first().click()
    const sash = window.getByTestId('git-panel-sash')
    await expect(sash).toBeVisible({ timeout: 5_000 })

    // Drag the sash upward and confirm the Changes pane shrinks.
    const changes = window.getByTestId('git-panel-changes-section')
    const before = await changes.boundingBox()
    const handle = await sash.boundingBox()
    if (!before || !handle) throw new Error('Missing layout boxes')
    await window.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await window.mouse.down()
    await window.mouse.move(handle.x + handle.width / 2, handle.y - 80, { steps: 8 })
    await window.mouse.up()
    const after = await changes.boundingBox()
    if (!after) throw new Error('Missing changes box after drag')
    expect(after.height).toBeLessThan(before.height)
  })
})
