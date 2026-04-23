# Contributing to DPlex

Thanks for your interest in improving DPlex! This document covers how
to set up a dev environment, the shape of the codebase, and the
conventions we follow when merging changes.

## Code of Conduct

Participation in this project is governed by our
[Code of Conduct](./CODE_OF_CONDUCT.md). By contributing you agree to
abide by its terms.

## Ways to contribute

- **Bug reports** — file an issue with reproduction steps, your OS, and
  the DPlex version. A short screen recording is gold.
- **Feature requests** — open an issue describing the problem first,
  not just the proposed solution.
- **New AI provider plugins** — DPlex is designed to be extensible.
  See the [Adding a new provider](#adding-a-new-ai-provider) section.
- **Pull requests** — for non-trivial changes, please open an issue to
  discuss the approach first so nobody does wasted work.
- **Docs, typos, examples** — always welcome.

## Development setup

### Prerequisites

- **Node.js 18+** (we build on current LTS).
- **Git**.
- A recent version of one or more AI CLI tools you want to test
  against (`copilot`, `claude`, etc.) — optional, but useful.

### Clone and install

```bash
git clone https://github.com/Ron537/DPlex.git
cd DPlex
npm install
```

### Run locally

```bash
npm run dev
```

This starts the Electron app in development mode with hot reload for
the renderer and fast rebuilds for the main/preload processes.

### Useful scripts

```bash
npm run typecheck     # TypeScript only (fast)
npm run lint          # ESLint
npm run test:unit     # Vitest unit tests
npm run test:e2e      # Playwright end-to-end tests (builds first)
npm run test:monkey   # Randomized monkey tests
npm run test:all      # Everything above
npm run build         # Typecheck + production build
npm run build:mac     # Package macOS .dmg (requires code-signing env vars for distributable output)
npm run build:win     # Package Windows installer
npm run build:linux   # Package Linux AppImage / .deb
```

## Project structure

DPlex uses `electron-vite` with three process targets:

```
src/
├── main/        # Node.js main process — PTY, filesystem, IPC handlers
├── preload/     # Thin bridge exposing window.dplex.* to the renderer
└── renderer/    # React + Tailwind renderer (no direct Node/FS access)
```

See the top-level `README.md` for the architecture overview, and the
in-repo `.github/copilot-instructions.md` for conventions that apply
across the codebase.

### Adding a new AI provider

Every AI CLI tool (Copilot, Claude, Codex, etc.) is wrapped by a
`SessionProvider` implementation in
`src/main/services/providers/`.

To add a new tool:

1. Create a class implementing `SessionProvider`
   (`src/main/services/providers/types.ts`).
2. Register it in `createDefaultRegistry()` inside
   `src/main/services/providers/index.ts`.

No other wiring is required. The provider owns: session discovery
from the filesystem, active-session detection, close/delete actions,
and the command used to resume a session.

## Coding conventions

- **TypeScript everywhere.** No implicit `any`.
- **Process boundaries are sacred.** Filesystem and process APIs live
  in `main/`. The renderer talks to the main process exclusively
  through the typed `DplexAPI` exposed by the preload script. When you
  add a new IPC channel, update all three of:
  1. The `ipcMain.handle` / `ipcMain.on` implementation in `main/`.
  2. The wrapper in `src/preload/index.ts`.
  3. The renderer call site (`window.dplex.*`).
- **Zustand stores** own domain state. Don't sprinkle IPC calls across
  random components.
- **Terminals are not destroyed on tab switch.** `terminalRegistry.ts`
  keeps xterm.js instances alive outside React's lifecycle.
- **Styling.** Tailwind utility classes, themed through
  `var(--dplex-*)` custom properties. Don't hardcode colors — they
  must adapt across light/dark themes.
- **Icons.** `lucide-react` exclusively.
- **Cross-platform.** DPlex targets macOS, Windows, and Linux. No
  hardcoded path separators, shell invocations, or signals that only
  work on one OS.

## Testing policy

For any change, please run the relevant tests before opening a PR:

- **Logic changes** — `npm run test:unit` at minimum.
- **UI or integration changes** — the affected Playwright suite
  (`npm run test:e2e` or `npm run test:monkey`).
- **New behavior** — please add or update tests so regressions get
  caught in CI.

PRs that fail CI will not be merged.

## Commit and PR conventions

- **Commit style.** Present-tense imperative: "Add provider registry"
  (not "added" / "adds"). Keep the summary line under ~72 characters.
  Body paragraphs explain *why*, not *what*.
- **Scope.** Prefer small, focused PRs. Large refactors are easier to
  review if split into logically ordered commits.
- **Breaking changes.** Call out anything that changes IPC contracts,
  stored session formats, or user-facing defaults in the PR
  description.
- **Screenshots.** Include before/after images or short recordings
  for any UI change.

### Pull request checklist

- [ ] Code compiles (`npm run typecheck`).
- [ ] Lint passes (`npm run lint`).
- [ ] Tests pass (`npm run test:unit`, plus any relevant Playwright
      suites).
- [ ] New behavior has tests.
- [ ] IPC changes update all three layers (main, preload, renderer).
- [ ] UI changes include screenshots in the PR.
- [ ] Docs (README, CONTRIBUTING, in-code comments) updated where
      relevant.

## Reporting security issues

Please **do not** open public issues for security vulnerabilities.
See [SECURITY.md](./SECURITY.md) for private disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed
under the project's [MIT License](./LICENSE).
