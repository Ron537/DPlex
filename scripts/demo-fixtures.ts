/**
 * Shared fixtures for the demo GIF + screenshot scripts.
 *
 * Keeping these in one place avoids drift between `demo-gif.ts` and
 * `screenshots.ts` (both seed the same fictional projects, colors, and a
 * fabricated Overview-dashboard snapshot).
 */

/** Per-project accent colors — show off the tab/project color feature. */
export const PROJECT_COLORS: Record<string, string> = {
  'p-app': '#6ea8fe',
  'p-api': '#63e6be',
  'p-www': '#ffa94d',
  'p-design': '#e599f7',
  'p-cli': '#ff8787'
}

/** The five demo project ids, in sidebar order. */
export const DEMO_PROJECT_IDS = ['p-app', 'p-api', 'p-www', 'p-design', 'p-cli']

/**
 * Extra *background* Spaces so the Spaces overview + switcher showcase the
 * feature (multiple workspaces you can jump between). Each binds real demo
 * projects and holds a few live AI sessions, so every overview card shows its
 * bound projects and running sessions rather than an empty "no projects · 0
 * sessions" shell.
 *
 * Returned as plain JSON-serializable objects (matches
 * `renderer/src/types/index.ts#Space`). The active "My Work" space is
 * auto-created by the app and patched separately.
 */
/** One live AI-session tab inside a background space's workspace snapshot. */
interface DemoSession {
  id: string
  title: string
  providerId: string
}

interface DemoSpaceSpec {
  id: string
  name: string
  color: string
  glyph: string
  projectIds: string[]
  sessions: DemoSession[]
  ageDays: number
}

/** The background spaces' definitions. Each binds real demo projects and holds
 *  a few live AI sessions so the Spaces overview never shows an empty card. */
const DEMO_SPACE_SPECS: DemoSpaceSpec[] = [
  {
    id: 'space-billing',
    name: 'Billing & Payments',
    color: '#ffa94d',
    glyph: '$',
    projectIds: ['p-api', 'p-app', 'p-www'],
    sessions: [
      { id: 'billing-s1', title: 'Make Stripe webhooks idempotent', providerId: 'copilot-cli' },
      { id: 'billing-s2', title: 'Wire the checkout summary panel', providerId: 'claude-code' }
    ],
    ageDays: 12
  },
  {
    id: 'space-search',
    name: 'Search & Indexing',
    color: '#63e6be',
    glyph: '◆',
    projectIds: ['p-api', 'p-app', 'p-www', 'p-design'],
    sessions: [
      { id: 'search-s1', title: 'Reindex the product catalog nightly', providerId: 'copilot-cli' },
      { id: 'search-s2', title: 'Add the global search box', providerId: 'claude-code' },
      { id: 'search-s3', title: 'Search input design tokens', providerId: 'copilot-cli' }
    ],
    ageDays: 5
  },
  {
    id: 'space-notify',
    name: 'Notifications',
    color: '#e599f7',
    glyph: '◈',
    projectIds: ['p-app', 'p-cli'],
    sessions: [
      { id: 'notify-s1', title: 'Build the toast notification queue', providerId: 'claude-code' },
      { id: 'notify-s2', title: 'Add a --watch flag to notify', providerId: 'copilot-cli' }
    ],
    ageDays: 2
  }
]

export function buildDemoSpaces(now = Date.now()): unknown[] {
  return DEMO_SPACE_SPECS.map((spec) => {
    const groupId = `g-${spec.id}`
    const tabs = spec.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      kind: 'terminal' as const,
      providerId: s.providerId,
      sessionId: s.id
    }))
    return {
      id: spec.id,
      name: spec.name,
      color: spec.color,
      glyph: spec.glyph,
      projectIds: spec.projectIds,
      workspace: {
        layout: { type: 'group', groupId },
        groups: [{ id: groupId, activeTabId: tabs[0]?.id ?? '', tabs }],
        activeGroupId: groupId
      },
      createdAt: now - spec.ageDays * 86_400_000,
      updatedAt: now - spec.ageDays * 3_600_000,
      lastActiveAt: now - spec.ageDays * 3_600_000
    }
  })
}

/**
 * Attention for a single background space's session, so exactly one overview
 * card reads as "needs you" (pulsing status dot + rolled-up tag) while the
 * others show calm, live-but-idle sessions. Keyed by `providerId:sessionId` to
 * match the seeded session tab.
 */
export function buildDemoSpaceAttention(now = Date.now()): unknown[] {
  const seed = (
    providerId: string,
    sessionId: string,
    displayName: string,
    kind: 'waitingForApproval' | 'waitingForInput' | 'finished',
    agoMs: number
  ): unknown => ({
    compositeId: `${providerId}:${sessionId}`,
    providerId,
    sessionId,
    displayName,
    kind,
    createdAt: now - agoMs,
    escalated: false,
    suppressed: false,
    seeded: true
  })
  return [
    seed('claude-code', 'search-s2', 'Add the global search box', 'waitingForApproval', 45_000)
  ]
}

/**
 * Build a plausible {@link DashboardMetrics}-shaped snapshot for the Overview
 * dashboard. Computed in Node and passed into the renderer so the historical
 * charts (activity, cadence, heatmap, top repos, provider mix) have data —
 * the live KPIs already derive from the seeded session store.
 *
 * Returned as a plain JSON-serializable object (matches
 * `main/services/dashboard/types.ts#DashboardMetrics`).
 */
export function buildDashboardMetrics(now = Date.now()): unknown {
  const DAY = 86_400_000
  const overTime = Array.from({ length: 30 }, (_, i) => {
    const dateMs = now - (29 - i) * DAY
    const copilot = 2 + Math.round(4 * Math.abs(Math.sin(i / 3)))
    const claude = 1 + Math.round(3 * Math.abs(Math.cos(i / 4)))
    return {
      dateMs,
      byProvider: { 'copilot-cli': copilot, 'claude-code': claude },
      total: copilot + claude
    }
  })

  const heatmap: Array<{ weekday: number; hour: number; count: number }> = []
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const work = hour >= 9 && hour <= 18 && weekday < 5
      const count = work
        ? 1 + Math.round(6 * Math.abs(Math.sin((hour - 8) / 3)))
        : hour > 19 && weekday < 6
          ? Math.round(Math.abs(Math.sin(weekday + hour)) * 2)
          : 0
      heatmap.push({ weekday, hour, count })
    }
  }

  const sessions = overTime.reduce((a, b) => a + b.total, 0)
  return {
    windowDays: 30,
    generatedAtMs: now,
    totals: { sessions, messages: sessions * 14, toolCalls: sessions * 6 },
    previousTotals: {
      sessions: Math.round(sessions * 0.82),
      messages: Math.round(sessions * 14 * 0.79),
      toolCalls: Math.round(sessions * 6 * 0.8)
    },
    providerSplit: [
      { providerId: 'copilot-cli', sessions: Math.round(sessions * 0.58) },
      { providerId: 'claude-code', sessions: Math.round(sessions * 0.42) }
    ],
    topRepos: [
      {
        repo: 'web-app',
        cwd: '~/Code/web-app',
        sessions: 34,
        messages: 512,
        toolCalls: 208,
        lastActiveMs: now - 6 * 60_000,
        branches: ['feat/dark-mode', 'main', 'fix/auth-bug']
      },
      {
        repo: 'api-server',
        cwd: '~/Code/api-server',
        sessions: 27,
        messages: 388,
        toolCalls: 173,
        lastActiveMs: now - 22 * 60_000,
        branches: ['main', 'feat/search-index']
      },
      {
        repo: 'design-system',
        cwd: '~/Code/design-system',
        sessions: 15,
        messages: 201,
        toolCalls: 74,
        lastActiveMs: now - 5 * DAY,
        branches: ['main']
      },
      {
        repo: 'marketing-site',
        cwd: '~/Code/marketing-site',
        sessions: 9,
        messages: 96,
        toolCalls: 31,
        lastActiveMs: now - 2 * DAY,
        branches: ['main']
      }
    ],
    overTime,
    heatmap
  }
}
