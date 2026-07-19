/**
 * Screenshot/demo script for DPlex.
 *
 * Launches the packaged Electron app against a fresh user-data-dir, seeds
 * a realistic but fictional project + session set via the renderer-side
 * `__dplex` debug hatch (gated by `localStorage["dplex-demo"]`), then
 * captures a series of PNGs into `docs/assets/`.
 *
 * Run with:
 *   npm run build && tsx scripts/screenshots.ts
 */

import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { execFileSync } from 'child_process'
import {
  PROJECT_COLORS,
  DEMO_PROJECT_IDS,
  buildDashboardMetrics,
  buildDemoSpaces
} from './demo-fixtures'

const REPO = process.cwd()
const OUT = path.join(REPO, 'docs', 'assets')
const MAIN_ENTRY = path.join(REPO, 'out', 'main', 'index.js')

// Supersample factor: size the window DPR× and zoom the renderer by DPR so the
// captured PNGs render at 2× the design resolution for crisp text.
const DPR = 2
const VIEW_W = 1440
const VIEW_H = 900

// ── Mock data ───────────────────────────────────────────────────────────
const FAKE_PROJECTS = [
  { id: 'p-app', name: 'web-app', branch: 'main' },
  { id: 'p-api', name: 'api-server', branch: 'main' },
  { id: 'p-www', name: 'marketing-site', branch: 'main' },
  { id: 'p-design', name: 'design-system', branch: 'main' },
  { id: 'p-cli', name: 'cli-tool', branch: 'main' }
]

const FAKE_WORKTREES = [
  { id: 'wt-app-feat', parentId: 'p-app', name: 'feat/dark-mode', branch: 'feat/dark-mode' },
  { id: 'wt-app-fix', parentId: 'p-app', name: 'fix/auth-bug', branch: 'fix/auth-bug' },
  { id: 'wt-api-search', parentId: 'p-api', name: 'feat/search-index', branch: 'feat/search-index' }
]

interface SeededProject {
  id: string
  name: string
  path: string
  addedAt: string
  pinned?: boolean
  tabColor?: string
  parentProjectId?: string
  parentRepoName?: string
  parentRepoPath?: string
  createdByDplexWorktree?: boolean
}

async function makeRepo(root: string, name: string, mods: string[]): Promise<string> {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  run(['init', '-b', 'main'])
  run(['config', 'user.email', 'demo@dplex.dev'])
  run(['config', 'user.name', 'DPlex Demo'])
  run(['config', 'commit.gpgsign', 'false'])
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n\nDemo repo.\n`)
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0' }, null, 2)
  )
  run(['add', '.'])
  run(['commit', '-m', 'init'])
  // Make uncommitted modifications so the Source Control view has content.
  for (const m of mods) {
    const full = path.join(dir, m)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, `// modified ${m}\nexport const value = 42\n`)
  }
  return dir
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── Fake AISession factory ──────────────────────────────────────────────
function fakeSessions(projectPaths: Record<string, string>): unknown[] {
  const provs = ['copilot-cli', 'claude-code']
  const summaries = [
    'Implement dark-mode toggle and persist preference in localStorage',
    'Refactor SidePanel to use a unified header layout',
    'Add full-text search index over the product catalog',
    'Investigate flaky e2e test in CI runner',
    'Wire OAuth flow with PKCE and refresh-token rotation',
    'Migrate Zustand stores to v5 with subscribeWithSelector',
    'Generate OpenAPI client for the public REST surface',
    'Fix accessibility issues flagged by axe in PR review',
    'Spike: GraphQL Federation for the design system',
    'Document the worktree workflow in CONTRIBUTING.md',
    'Tune xterm WebGL renderer perf on large outputs',
    'Add prompt-history viewer to the sessions panel'
  ]
  const sessions: unknown[] = []
  let i = 0
  for (const pid of Object.keys(projectPaths)) {
    const cwd = projectPaths[pid]
    for (let k = 0; k < 3; k++) {
      const isActive = i < 4
      const minutesAgo = isActive ? Math.floor(Math.random() * 30) : 60 + i * 47
      const created = new Date(Date.now() - minutesAgo * 60_000)
      sessions.push({
        id: `sess-${pid}-${k}-${Math.random().toString(36).slice(2, 8)}`,
        displayName: summaries[i % summaries.length],
        summary: summaries[i % summaries.length],
        status: isActive ? 'active' : 'idle',
        aiTool: provs[i % provs.length],
        createdAt: created,
        updatedAt: created,
        cwd,
        branch: 'main',
        messageCount: 6 + Math.floor(Math.random() * 30),
        toolCallCount: Math.floor(Math.random() * 12),
        lastActivityTime: created.getTime()
      })
      i++
    }
  }
  return sessions
}

async function main(): Promise<void> {
  await fs.mkdir(OUT, { recursive: true })

  // ── 1. Build temp repos ───────────────────────────────────────────────
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-demo-'))
  const projectPaths: Record<string, string> = {}
  for (const p of FAKE_PROJECTS) {
    const mods =
      p.id === 'p-app'
        ? ['src/App.tsx', 'src/Header.tsx', 'src/ThemeProvider.tsx']
        : p.id === 'p-api'
          ? ['src/handlers/auth.ts']
          : ['src/index.ts']
    projectPaths[p.id] = await makeRepo(root, p.name, mods)
  }
  for (const w of FAKE_WORKTREES) {
    const parentDir = projectPaths[w.parentId]
    const wtDir = path.join(
      parentDir,
      '..',
      `${path.basename(parentDir)}-${w.branch.replace(/\//g, '-')}`
    )
    execFileSync('git', ['worktree', 'add', '-b', w.branch, wtDir, 'main'], {
      cwd: parentDir,
      stdio: 'ignore'
    })
    // Touch a file so worktree has changes too
    await fs.writeFile(path.join(wtDir, 'NOTES.md'), '# work in progress\n')
    projectPaths[w.id] = wtDir
  }

  // ── 2. Build the seeded projects payload ──────────────────────────────
  const seeded: SeededProject[] = []
  for (const p of FAKE_PROJECTS) {
    seeded.push({
      id: p.id,
      name: p.name,
      path: projectPaths[p.id],
      addedAt: nowIso(),
      pinned: p.id === 'p-app' || p.id === 'p-api',
      tabColor: PROJECT_COLORS[p.id]
    })
  }
  for (const w of FAKE_WORKTREES) {
    const parent = FAKE_PROJECTS.find((p) => p.id === w.parentId)!
    seeded.push({
      id: w.id,
      name: w.name,
      path: projectPaths[w.id],
      addedAt: nowIso(),
      parentProjectId: parent.id,
      parentRepoName: parent.name,
      parentRepoPath: projectPaths[parent.id],
      createdByDplexWorktree: true
    })
  }

  // ── 3. Launch Electron with isolated user-data-dir ────────────────────
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dplex-demo-ud-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DPLEX_E2E: '1',
    HOME: userDataDir,
    XDG_CONFIG_HOME: userDataDir,
    XDG_DATA_HOME: userDataDir,
    XDG_STATE_HOME: userDataDir
  }
  if (process.platform === 'win32') {
    env.USERPROFILE = userDataDir
    env.APPDATA = userDataDir
    env.LOCALAPPDATA = userDataDir
  }

  // Pre-seed settings.json so the app starts on the right view + theme.
  const seedSettings = {
    sidebarVisible: true,
    sidebarPanelCollapsed: false,
    sidebarActiveTab: 'projects',
    sidebarWidth: 280,
    theme: 'dark',
    projectPanelShowFooter: true,
    projects: seeded
  }
  await fs.writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify(seedSettings))

  const app: ElectronApplication = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    env
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Set the demo flag and reload so __dplex hatch is exposed.
  await window.evaluate(() => {
    localStorage.setItem('dplex-demo', '1')
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForFunction(
    // @ts-expect-error injected
    () => Boolean(window.__dplex?.projectStore)
  )

  // Size the window DPR× and zoom the renderer so the layout stays 1440×900
  // (the design shape) while screenshots capture at 2× for crisp text.
  await window.setViewportSize({ width: VIEW_W * DPR, height: VIEW_H * DPR })
  await app.evaluate(({ BrowserWindow }, dpr) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(dpr)
  }, DPR)

  // Wait for the underlying PTY shell to finish its initial render +
  // SIGWINCH-triggered re-render after the resize. Otherwise the shell
  // prompt sneaks back in below our painted fake content.
  await new Promise((r) => setTimeout(r, 2500))

  // Inject sessions + a fake "active" terminal title.
  await window.evaluate((sessions) => {
    // @ts-expect-error injected
    window.__dplex.sessionStore.setState({ sessions, loading: false })
  }, fakeSessions(projectPaths))

  // Bind the seeded projects to the active Space so the switcher reads "5 proj",
  // and seed a few background spaces so the Spaces switcher has a real list.
  await window.evaluate(
    ({ projectIds, extraSpaces }) => {
      // @ts-expect-error injected
      const ss = window.__dplex.spaceStore.getState()
      if (!ss.activeSpaceId) return
      const patched = ss.spaces.map((s: { id: string; projectIds: string[] }) =>
        s.id === ss.activeSpaceId ? { ...s, projectIds } : s
      )
      // @ts-expect-error injected
      window.__dplex.spaceStore.setState({ spaces: [...patched, ...extraSpaces] })
    },
    { projectIds: DEMO_PROJECT_IDS, extraSpaces: buildDemoSpaces() }
  )

  // Deliberately do NOT seed space attention here: the screenshots should show
  // the workspace at rest, with no "needs you" badges or Resume notification
  // toasts overlaying the UI.

  // Helpers
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const shoot = async (name: string): Promise<void> => {
    await sleep(400)
    const file = path.join(OUT, `${name}.png`)
    await window.screenshot({ path: file })
    console.log(`✓ ${name}.png`)
  }

  // Expand the active project so worktrees + sessions show.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const proj = window.__dplex.projectStore
    proj.setState({
      expandedProjectIds: new Set(['p-app', 'p-api']),
      activeProjectId: 'p-app',
      lastExpandedProjectId: 'p-app'
    })
  })
  await sleep(800)

  // Helper that paints the fake AI-conversation buffer.
  const paintTerminal = async (): Promise<void> => {
    await window.evaluate(() => {
      // @ts-expect-error injected
      const groups = window.__dplex.terminalStore.getState().groups
      if (!groups[0] || !groups[0].tabs[0]) return
      const tabId = groups[0].tabs[0].id
      // @ts-expect-error injected
      const entry = window.__dplex.terminalRegistry.getTerminalEntry(tabId)
      if (!entry || !entry.term) return
      const t = entry.term
      const ESC = '\x1b'
      const RESET = `${ESC}[0m`
      const DIM = `${ESC}[2m`
      const BOLD = `${ESC}[1m`
      const CYAN = `${ESC}[36m`
      const GREEN = `${ESC}[32m`
      const BLUE = `${ESC}[34m`
      const YELLOW = `${ESC}[33m`
      const MAGENTA = `${ESC}[35m`
      const lines = [
        // Clear scrollback (\x1b[3J) + screen (\x1b[2J) + cursor home (\x1b[H)
        // to wipe the underlying shell's `user@host %` prompt before painting.
        `${ESC}[3J${ESC}[2J${ESC}[H`,
        `${DIM}~/code/web-app  ${CYAN}feat/dark-mode${RESET}`,
        `${DIM}$${RESET} copilot --resume=8c4a2f`,
        ``,
        `${BOLD}${MAGENTA}● ${BOLD}Implement a system-aware dark mode toggle${RESET}`,
        `${DIM}  Resumed · 24 messages · 6 tool calls${RESET}`,
        ``,
        `${BLUE}${BOLD}You${RESET}`,
        `${DIM}  Add a dark-mode toggle to the header that follows the OS${RESET}`,
        `${DIM}  preference by default but lets the user override it.${RESET}`,
        `${DIM}  Persist the choice in localStorage.${RESET}`,
        ``,
        `${GREEN}${BOLD}● Copilot${RESET}`,
        `  I'll add a ThemeProvider that watches \`prefers-color-scheme\``,
        `  and exposes a toggle. Let me check the current styling setup.`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}readFile${RESET} src/App.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}87 lines${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}create${RESET} src/ThemeProvider.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}48 lines${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}edit${RESET} src/Header.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}+12 −1${RESET}`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}run${RESET} npm test -- ThemeProvider`,
        `  ${GREEN}✓${RESET} ${DIM}5 passed${RESET}`,
        ``,
        `  Done. Header has a sun/moon toggle, ThemeProvider syncs with`,
        `  the OS via ${CYAN}matchMedia${RESET}, and the choice persists across`,
        `  reloads.`,
        ``,
        `${BLUE}${BOLD}You${RESET} ${DIM}▏${RESET}`
      ]
      t.write(lines.join('\r\n'))
    })
  }

  await paintTerminal()
  await sleep(800)

  // 1. Hero — Projects view, dark theme, expanded with worktrees + sessions.
  await shoot('01-hero-projects')

  // 2. Sessions tab.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.settingsStore.getState().updateSettings({ sidebarActiveTab: 'sessions' })
  })
  await sleep(600)
  await shoot('02-sessions-panel')

  // 3. Source Control tab.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.settingsStore.getState().updateSettings({ sidebarActiveTab: 'git' })
  })
  await sleep(1200)
  await shoot('03-source-control')

  // 4. Settings modal — Notifications tab.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.settingsStore.getState().updateSettings({ sidebarActiveTab: 'projects' })
    window.dispatchEvent(new CustomEvent('dplex:open-settings'))
  })
  await sleep(900)
  // Click the Notifications tab in the modal sidebar.
  const notifTab = window.locator('button', { hasText: 'Notifications' }).first()
  if (await notifTab.count()) {
    await notifTab.click()
    await sleep(500)
  }
  await shoot('04-settings-notifications')
  const closeBtn = window.locator('[aria-label="Close settings"]').first()
  if (await closeBtn.count()) {
    await closeBtn.click({ timeout: 5000 }).catch(() => undefined)
  } else {
    await window.keyboard.press('Escape')
  }
  await sleep(600)

  // 5. Light theme — repeat the hero shot.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.settingsStore.getState().updateSettings({ theme: 'github-light' })
    // @ts-expect-error injected
    window.__dplex.applyCssVarsSync('github-light')
    // @ts-expect-error injected
    window.__dplex.terminalRegistry.applyThemeToAll('github-light')
  })
  await sleep(800)
  await paintTerminal()
  await sleep(800)
  await shoot('05-light-theme')

  // 6. Project picker open inside Source Control (dark again).
  await window.evaluate(() => {
    // @ts-expect-error injected
    const s = window.__dplex.settingsStore.getState()
    s.updateSettings({ theme: 'dark', sidebarActiveTab: 'git' })
    // @ts-expect-error injected
    window.__dplex.terminalRegistry.applyThemeToAll('dark')
  })
  await sleep(700)
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ps = window.__dplex.projectStore.getState()
    const next = ps.projects.map(
      (p: {
        id: string
        path: string
        name: string
        parentProjectId?: string
        parentRepoName?: string
      }) => ({
        ...p,
        path: p.parentProjectId
          ? '~/Code/' + (p.parentRepoName ?? 'project') + '/.worktrees/' + p.name
          : '~/Code/' + p.name
      })
    )
    // @ts-expect-error injected
    window.__dplex.projectStore.setState({ projects: next })
  })
  await sleep(300)
  const trigger = window.getByTestId('git-project-picker-trigger')
  if (await trigger.count()) {
    await trigger.click()
    await sleep(500)
    await shoot('06-project-picker')
    await window.keyboard.press('Escape')
  }
  await sleep(400)

  // 7. Split-screen — multiple terminals running concurrently.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore
    const state = ts.getState()
    if (state.groups[0]) {
      // Vertical split (side-by-side), then horizontal split on the right
      // pane (top-bottom) → 3-pane mosaic.
      const right = state.activeGroupId
      if (right) ts.getState().splitGroup(right, 'vertical')
    }
  })
  await sleep(1500)
  // Now we have 2 groups — split the right one horizontally for a 3-pane look.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore
    const state = ts.getState()
    if (state.activeGroupId) ts.getState().splitGroup(state.activeGroupId, 'horizontal')
  })
  await sleep(1500)
  // Switch sidebar to Projects so the panel context matches the wide layout.
  await window.evaluate(() => {
    // @ts-expect-error injected
    window.__dplex.settingsStore.getState().updateSettings({ sidebarActiveTab: 'projects' })
  })
  await sleep(400)
  // Paint distinct content into each terminal so the split is meaningful.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const groups = window.__dplex.terminalStore.getState().groups
    const ESC = '\x1b'
    const RESET = `${ESC}[0m`
    const DIM = `${ESC}[2m`
    const BOLD = `${ESC}[1m`
    const CYAN = `${ESC}[36m`
    const GREEN = `${ESC}[32m`
    const BLUE = `${ESC}[34m`
    const YELLOW = `${ESC}[33m`
    const MAGENTA = `${ESC}[35m`
    const paints = [
      [
        `${ESC}[3J${ESC}[2J${ESC}[H`,
        `${DIM}~/code/web-app  ${CYAN}feat/dark-mode${RESET}`,
        `${DIM}$${RESET} copilot`,
        ``,
        `${BOLD}${MAGENTA}● ${BOLD}Implement dark-mode toggle${RESET}`,
        ``,
        `${GREEN}${BOLD}● Copilot${RESET}`,
        `  ${YELLOW}▸${RESET} ${DIM}edit${RESET} src/Header.tsx`,
        `  ${GREEN}✓${RESET} ${DIM}+12 −1${RESET}`,
        ``,
        `  Toggle wired up. ${BLUE}▏${RESET}`
      ].join('\r\n'),
      [
        `${ESC}[3J${ESC}[2J${ESC}[H`,
        `${DIM}~/code/api-server  ${CYAN}main${RESET}`,
        `${DIM}$${RESET} claude`,
        ``,
        `${BOLD}${MAGENTA}● ${BOLD}Add OAuth refresh-token rotation${RESET}`,
        ``,
        `${GREEN}${BOLD}● Claude${RESET}`,
        `  Reading the current session middleware...`,
        ``,
        `  ${YELLOW}▸${RESET} ${DIM}readFile${RESET} src/handlers/auth.ts`,
        `  ${GREEN}✓${RESET} ${DIM}204 lines${RESET}`,
        ``,
        `  Drafting rotation logic...${BLUE}▏${RESET}`
      ].join('\r\n'),
      [
        `${ESC}[3J${ESC}[2J${ESC}[H`,
        `${DIM}~/code/web-app${RESET}`,
        `${DIM}$${RESET} npm test -- --watch`,
        ``,
        `${GREEN}PASS${RESET} src/ThemeProvider.test.tsx`,
        `  ✓ resolves system preference (12ms)`,
        `  ✓ persists override to localStorage (8ms)`,
        `  ✓ updates on prefers-color-scheme change (15ms)`,
        ``,
        `${GREEN}PASS${RESET} src/Header.test.tsx`,
        `  ✓ renders sun/moon toggle (6ms)`,
        ``,
        `${BOLD}Tests:${RESET}       ${GREEN}9 passed${RESET}, 9 total`,
        `${BOLD}Time:${RESET}        2.41 s`,
        `${DIM}Watching for changes…${RESET}${BLUE}▏${RESET}`
      ].join('\r\n')
    ]
    let i = 0
    for (const g of groups) {
      for (const t of g.tabs) {
        // @ts-expect-error injected
        const entry = window.__dplex.terminalRegistry.getTerminalEntry(t.id)
        if (!entry?.term) continue
        if (i < paints.length) {
          entry.term.write(paints[i])
          i++
        }
      }
    }
  })
  await sleep(900)
  await shoot('07-split-screen')

  // 8. Worktrees — Settings → Worktrees tab.
  await window.evaluate(() => {
    window.dispatchEvent(new CustomEvent('dplex:open-settings'))
  })
  await sleep(700)
  const worktreesTab = window.locator('button', { hasText: 'Worktrees' }).first()
  if (await worktreesTab.count()) {
    await worktreesTab.click()
    await sleep(500)
  }
  await shoot('08-worktrees-settings')
  const closeBtn2 = window.locator('[aria-label="Close settings"]').first()
  if (await closeBtn2.count()) {
    await closeBtn2.click({ timeout: 5000 }).catch(() => undefined)
  } else {
    await window.keyboard.press('Escape')
  }
  await sleep(400)

  // 9. Overview dashboard — the bird's-eye view of every AI session. Live
  //    cards read the seeded sessions; historical charts read a fabricated
  //    snapshot (marked clean so the tab's on-mount refresh won't blank it).
  //    Collapse any leftover split first so the dashboard renders full-width.
  await window.evaluate(() => {
    // @ts-expect-error injected
    const ts = window.__dplex.terminalStore.getState()
    const g = ts.getActiveGroup?.() ?? ts.groups[0]
    if (!g) return
    // @ts-expect-error injected
    window.__dplex.terminalStore.setState({
      groups: [g],
      layout: { type: 'group', groupId: g.id },
      activeGroupId: g.id
    })
  })
  await sleep(300)
  await window.evaluate((metrics) => {
    // @ts-expect-error injected
    window.__dplex.dashboardStore.setState({
      metrics,
      loading: false,
      error: null,
      dirty: false,
      lastLoadedAt: Date.now()
    })
  }, buildDashboardMetrics())
  const dashTab = window.getByTestId('activity-bar-dashboard')
  if (await dashTab.count()) {
    await dashTab.click()
    await sleep(1200)
  }
  await shoot('09-overview-dashboard')

  // 10. Spaces overview — mission control for your workspaces. Step back to
  //     the overview grid showing the active space plus seeded background
  //     spaces, each with its bound projects and color.
  const overviewOk = await window
    .evaluate(() => {
      // @ts-expect-error injected demo hatch
      const ss = window.__dplex?.spaceStore?.getState?.()
      if (!ss) return false
      ss.sendToBackground()
      return true
    })
    .catch(() => false)
  if (overviewOk) {
    await sleep(700)
    await shoot('10-spaces-overview')
  }

  await app.close()
  await fs.rm(userDataDir, { recursive: true, force: true })
  await fs.rm(root, { recursive: true, force: true })
  console.log(`\nDone. Screenshots in ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
