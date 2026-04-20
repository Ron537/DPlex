# DPlex — Copilot Instructions

## Build & Run

```bash
npm run dev          # Start Electron app in dev mode (hot reload)
npm run build        # Typecheck + build (runs typecheck:node && typecheck:web first)
npm run lint         # ESLint across entire project
npm run typecheck    # TypeScript check only (no build)
npm run test:unit    # Run unit tests (Vitest)
npm run test:e2e     # Run Electron end-to-end tests (Playwright)
npm run test:monkey  # Run randomized monkey tests (Playwright)
npm run test:all     # Run all tests
```

## Architecture

DPlex is an Electron + React terminal multiplexer that manages AI CLI tool sessions (Copilot CLI, Claude Code, etc.). It uses electron-vite with three process targets:

### Process Boundaries

- **Main process** (`src/main/`) — Node.js. PTY management via `node-pty`, session discovery from filesystem, settings persistence. All file system and process operations live here.
- **Preload** (`src/preload/index.ts`) — IPC bridge. Defines `DplexAPI` interface exposed as `window.dplex`. This is the **sole contract** between main and renderer — every new IPC channel must be added to both the type definition and the implementation in this file.
- **Renderer** (`src/renderer/`) — React + Tailwind CSS v4. No direct Node.js or filesystem access; everything goes through `window.dplex.*` IPC calls.

### Provider System (AI Tool Abstraction)

AI tools are abstracted behind `SessionProvider` interface (`src/main/services/providers/types.ts`). To add a new AI CLI tool:

1. Create a class implementing `SessionProvider` in `src/main/services/providers/`
2. Register it in `createDefaultRegistry()` in `providers/index.ts`

No other files need changes. The provider handles: session discovery, active session detection, close/delete, resume command generation, and session resolution by PID/CWD.

`ProviderRegistry` aggregates operations across all providers. IPC handlers in `main/index.ts` delegate to the registry.

### State Management

Zustand stores (no Redux). Four stores, each owning a specific domain:

- **terminalStore** — Terminal tabs, editor groups, split layout tree. Auto-persists AI session tabs to disk via debounced save. The layout is a recursive `LayoutNode` tree (group | split).
- **projectStore** — Project list, drag-and-drop ordering, active session tracking (event-driven via provider watchers; no polling).
- **sessionStore** — Session history list (discovered from providers), search/filter.
- **settingsStore** — App settings with immediate persistence.

### Terminal Lifecycle

Terminals are **not** destroyed when switching tabs. The `terminalRegistry.ts` service maintains a global `Map<string, TerminalEntry>` outside React's lifecycle. xterm.js DOM elements are attached/detached from containers as tabs activate — this preserves scrollback and running processes.

The `useTerminal` hook handles: PTY creation, IPC wiring (data/exit events), resize observation, and session ID resolution (with retry logic for slow-starting AI tools).

### PTY Creation

When a `command` is provided (AI session), the PTY runs as a login shell with exec replacement: `[shell] -l -c "exec <command>"`. This ensures PATH is configured but the shell process is replaced — there is no shell to fall back to when the AI tool exits.

### Workspace Persistence

AI session tabs are serialized to `sessions.json` in the Electron userData directory. On quit, `saveWorkspaceSync` (synchronous IPC) ensures reliable save. On restore, session tabs are recreated with their original command and CWD, and session IDs are re-resolved by PID after PTY creation.

## Conventions

- **CSS**: Tailwind utility classes with CSS custom properties for theming (`var(--dplex-text)`, `var(--dplex-bg)`, etc.). Theme definitions live in `services/themes.ts`.
- **IPC pattern**: Main defines handlers via `ipcMain.handle`/`ipcMain.on`. Preload wraps them in typed functions. Renderer calls `window.dplex.*`. Always update all three when adding new IPC channels.
- **Icons**: `lucide-react` exclusively.
- **No `async` in Zustand actions that callers expect to be synchronous** — use `.then()` internally if you need async IPC, otherwise click handlers and Zustand subscriptions may silently swallow errors.
- **Session active detection**: Check for `inuse.<PID>.lock` files, then verify PID is alive via `process.kill(pid, 0)`. This is provider-specific logic inside each provider class.
- **Do not commit or push to git without explicit user approval.** Always wait for the user to confirm before running `git commit` or `git push`.
- **Status colors**: Use CSS custom properties (`var(--dplex-status-*)`) defined in `settingsStore.ts` via `applyCssVarsSync()`. Never hardcode status colors — they adapt for light/dark theme contrast. Use `STATUS_ACTIVE_COLOR` and `STATUS_ACTIVE_BG` from `utils/statusColors.ts` for active badges.
- **Hover backgrounds**: Always use `hover:bg-[var(--dplex-hover)]` — never `hover:bg-white/5` or `hover:bg-white/10` which are invisible on light themes.
- **Testing policy**: After each change, run relevant automated tests before finishing work. At minimum run `npm run test:unit` for logic changes and the affected Playwright suite (`npm run test:e2e` / `npm run test:monkey`) for UI or integration changes.
- **Regression prevention**: Every new behavior must include or update relevant tests so regressions are caught in CI.

## Code Review Policy

After every major change (project refactors, new features, architectural changes — not minor styling tweaks or few-line fixes), automatically run a deep dual-model code review before committing. The same procedure applies whenever the user explicitly asks to "run a code review" (or similar wording).

1. Launch **two parallel code-review agents** using the `task` tool with `agent_type: "code-review"`:
   - One with `model: "claude-opus-4.7"` 
   - One with `model: "gpt-5.4"`
2. Both reviews must cover **all** of the following:
   - **Dead code** — unused imports, variables, functions, classes, types, exports, IPC handlers, and anything else that is no longer referenced
   - **Duplicate code** — near-identical logic across files that should be extracted into a shared helper/module for reuse
   - **Memory leaks** — event listener cleanup, subscription management, timer/interval cleanup, React effect cleanup, PTY/watcher disposal
   - **Security** — XSS vectors, unsafe eval, prototype pollution, path traversal, shell injection, exposure of secrets
   - **Race conditions** — async conflicts, stale closures, missing cancellation
   - **Performance** — unnecessary re-renders, missing memoization, O(n²) loops, redundant polling mechanisms, irrelevant or duplicated file watching, non-optimized queries/IPC round-trips
   - **Best practices** — verify established patterns and idioms are followed; call out anti-patterns
   - **Cross-platform support** — no implementation that only works on one OS. The project must support **macOS, Windows, and Linux**. Flag hardcoded path separators, shell invocations, signals, env vars, or APIs that don't work on all three.
   - **Correctness** — logic errors, edge cases, null/undefined handling, type safety
   - **Clean, reusable, maintainable code** — consistent patterns, clear naming, appropriate abstractions, DRY
   - **File size & separation of concerns** — no oversized files mixing multiple unrelated areas. Each file should own a single, well-defined area. Split files that handle multiple concerns into isolated, area-specific files/classes.
   - **Design patterns** — proper separation of concerns, DRY, extensibility
3. Wait for both reviews to complete, then **fix all genuine issues** before committing.
4. Report a summary of findings and fixes to the user.
