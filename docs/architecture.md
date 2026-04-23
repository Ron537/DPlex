# Architecture

DPlex is an Electron desktop application that orchestrates AI CLI tool
sessions (GitHub Copilot CLI, Claude Code, etc.) inside a single
multiplexed terminal workspace. This document covers the top-level
shape of the codebase and the design decisions behind it.

If you're adding a new AI provider, see
[`docs/providers.md`](./providers.md) instead.

## Process model

DPlex uses [`electron-vite`](https://electron-vite.org/) with three
process targets:

```
┌──────────────────────────────────────────────────────────────────┐
│                        Electron main process                     │
│  src/main/                                                       │
│   - Owns Node.js APIs: fs, child_process, node-pty, IPC          │
│   - PTY lifecycle, session discovery, settings persistence       │
│   - Provider registry (Copilot, Claude, ...)                     │
│   - Auto-update                                                  │
└─────────────────────────────┬────────────────────────────────────┘
                              │  IPC (electron contextBridge)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Preload bridge                              │
│  src/preload/index.ts                                            │
│   - Exposes window.dplex.* (typed DplexAPI)                      │
│   - Sole contract between main and renderer                      │
│   - Adding an IPC channel = update all three layers              │
└─────────────────────────────┬────────────────────────────────────┘
                              │  window.dplex.*
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Renderer (React)                           │
│  src/renderer/                                                   │
│   - No direct Node / FS / process access                         │
│   - Zustand stores own domain state                              │
│   - xterm.js terminals + Tailwind UI                             │
└──────────────────────────────────────────────────────────────────┘
```

### Security posture

- `contextIsolation: true`, `nodeIntegration: false`.
- `sandbox: false` is required for `node-pty` integration. This is a
  deliberate trade-off and the reason the IPC surface is the project's
  most important security boundary.
- `shell.openExternal` and `will-navigate` reject any URL scheme other
  than `http`, `https`, `mailto`. Closes the classic Electron
  protocol-handler RCE vector.
- All shell command execution uses `execFile(cmd, [args])` (no shell
  interpretation of arguments). PTY commands route through the user's
  login shell with `exec` replacement so there's no fall-back shell
  after the AI tool exits.

## State management (renderer)

Four Zustand stores, each owning a specific domain:

| Store              | Owns                                                         |
| ------------------ | ------------------------------------------------------------ |
| `terminalStore`    | Terminal tabs, editor groups, recursive split layout tree    |
| `projectStore`     | Project list, ordering, pinning, expanded state, worktrees   |
| `sessionStore`     | Discovered AI session history, search/filter                 |
| `settingsStore`    | App settings, immediate persistence, theme application       |

Stores never call IPC inline from a click handler; instead they own
the orchestration so callers don't need to know about main-process
plumbing. Side-effectful actions (`startAISession`, `togglePin`, etc.)
return a Promise where useful but never `await` from inside Zustand
subscriptions to avoid silent error swallowing.

## Terminal lifecycle

Terminals are **not** destroyed on tab switch. The
`src/renderer/src/services/terminalRegistry.ts` module keeps a global
`Map<string, TerminalEntry>` outside React's lifecycle. xterm.js DOM
elements are attached to and detached from container `<div>`s as tabs
become active. This preserves scrollback and any running process.

A few notable consequences:

- `useTerminal` is a thin React wrapper that mounts/unmounts the DOM
  element from the registry — the heavy lifting (`new Terminal(...)`,
  resize observers, IPC wiring) happens in the registry itself.
- PTY processes live entirely in the main process; the renderer
  receives data through IPC events and writes input back through an
  IPC channel.

## Workspace persistence

AI session tabs are serialized to `sessions.json` in the Electron
`userData` directory:

- On quit, `saveWorkspaceSync` ensures a synchronous save so a SIGTERM
  doesn't lose state.
- On restore, session tabs are recreated with their original command
  and CWD; session IDs are re-resolved from PID after PTY creation
  with retry logic (some AI tools take a beat to write their lock
  file).

## Provider system

Every AI CLI tool implements the `SessionProvider` interface in
`src/main/services/providers/types.ts`:

```ts
interface SessionProvider {
  readonly id: string
  readonly name: string
  readonly command: string
  discoverSessions(): Promise<DiscoveredSession[]>
  closeSession(id: string): Promise<boolean>
  deleteSession(id: string): Promise<void>
  resolveSessionByPid(pid: number): Promise<ResolvedSession | null>
  resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null>
  getResumeCommand(id: string): string
  getNewSessionCommand(): string
  startWatching(callbacks: WatcherCallbacks): Promise<void>
  stopWatching(): void
  getPrompts(id: string, limit?: number): Promise<SessionPrompt[]>
}
```

The `ProviderRegistry` aggregates all registered providers; the IPC
handlers in `src/main/index.ts` simply delegate to the registry. The
renderer never knows or cares which provider a session belongs to
beyond an opaque `aiTool` string.

See [`docs/providers.md`](./providers.md) for a step-by-step guide to
implementing a new provider.

## IPC pattern

When you add a new IPC channel you must touch all three layers:

1. **Main** — `ipcMain.handle('namespace:method', ...)` or
   `ipcMain.on(...)` for fire-and-forget events.
2. **Preload** — typed wrapper added to `DplexAPI` in
   `src/preload/index.ts`.
3. **Renderer** — call sites use `window.dplex.namespace.method(...)`.

The typed `DplexAPI` interface is the project's single source of
truth for the renderer/main contract. Treat it like a public API.

## Cross-platform expectations

DPlex targets **macOS, Windows, and Linux**. Anything that touches
process spawning, file paths, or shell invocation must work on all
three:

- Use `path.join` / `path.sep`, never literal `/` or `\\`.
- Never assume a POSIX shell is available — use `execFile` with argv,
  or `node-pty` for terminals.
- For platform-specific behavior (taskkill on Windows, signals on
  POSIX), branch on `process.platform` with a clear fallback.
- The matrixed unit-test workflow runs on all three OS in CI; the
  Electron e2e runs on Linux only (headful Electron in CI matrices
  is too flaky to be useful).

## Where to look

- `src/main/index.ts` — the bulk of IPC wiring + window lifecycle.
- `src/main/services/ptyManager.ts` — PTY creation, `exec` shell
  invocation, login-shell semantics.
- `src/main/services/providers/copilotProvider.ts` — reference
  provider implementation; copy this when adding a new tool.
- `src/preload/index.ts` — the entire renderer/main contract.
- `src/renderer/src/services/terminalRegistry.ts` — terminal lifetime
  outside React.
- `src/renderer/src/stores/*.ts` — domain state.
