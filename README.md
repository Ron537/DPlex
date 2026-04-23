<div align="center">

# DPlex

**A terminal multiplexer built for AI-assisted development**

DPlex is a desktop terminal app that manages multiple AI CLI tool sessions alongside regular terminals — all in one window. Think of it as a purpose-built workspace for developers who use tools like GitHub Copilot CLI, Claude Code, or Codex CLI daily across multiple projects.

[![Tests](https://github.com/Ron537/DPlex/actions/workflows/tests.yml/badge.svg)](https://github.com/Ron537/DPlex/actions/workflows/tests.yml)
[![CodeQL](https://github.com/Ron537/DPlex/actions/workflows/codeql.yml/badge.svg)](https://github.com/Ron537/DPlex/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Ron537/DPlex?include_prereleases&sort=semver)](https://github.com/Ron537/DPlex/releases)
[![Issues](https://img.shields.io/github/issues/Ron537/DPlex)](https://github.com/Ron537/DPlex/issues)
[![Discussions](https://img.shields.io/github/discussions/Ron537/DPlex)](https://github.com/Ron537/DPlex/discussions)

Built with Electron · React · TypeScript

[Download](#install) · [Features](#features) · [How DPlex compares](#how-dplex-compares) · [Architecture](./docs/architecture.md) · [Add a provider](./docs/providers.md) · [Contributing](./CONTRIBUTING.md)

</div>

> **🚧 Pre-1.0.** DPlex is functional and used daily by its author, but
> APIs, settings layout, and on-disk formats may shift between minor
> versions while we feel out the right shape. Please pin your version
> and read the [CHANGELOG](./CHANGELOG.md) before upgrading.

---

<!--
TODO: Add hero screenshot/GIF here. Recommended: a 10-second screen
recording of starting a Copilot session, splitting the pane, switching
to a project, and resuming a past session. Use Kap or Loom, export to
~3MB GIF, host in /docs/assets/ or as a Release asset.
-->

## Why DPlex?

When working with AI CLI tools across multiple projects, you end up with a mess of terminal windows — one Copilot session here, a Claude session there, plus regular shells scattered everywhere. DPlex solves this by giving you:

- **One window** with split panes, tabs, and a project sidebar.
- **Automatic session discovery** — sees your active and past AI sessions without manual tracking.
- **Session persistence** — close the app, reopen it, and your AI sessions are restored exactly where you left off.
- **Project-aware management** — group sessions by project, start new AI sessions with one click.
- **Worktree-friendly** — first-class Git worktree support so concurrent feature work doesn't pollute your main checkout.

## Install

> **Heads-up:** packaged binaries for the current pre-release are not
> yet attached to GitHub Releases. Until v0.1.0 is tagged, run from
> source.

### Download (coming with v0.1.0)

- **macOS** — `.dmg` (arm64 + x64). Apple Silicon notarization is on
  the roadmap; for now you may need to right-click → Open the first
  time.
- **Windows** — `.exe` installer. Code signing is on the roadmap.
- **Linux** — `.AppImage`, `.deb`, `.snap`.

Until binaries land, `git clone` and run from source — see below.

### Run from source

#### Prerequisites

- **Node.js 18+** (we develop on 22 LTS).
- **Git**.
- One or more AI CLI tools installed — `copilot`, `claude`, etc. — if
  you want them auto-discovered.

```bash
git clone https://github.com/Ron537/DPlex.git
cd DPlex
npm install
npm run dev
```

### Build for distribution

```bash
npm run build:mac     # macOS .dmg + .zip (arm64 + x64)
npm run build:win     # Windows .exe installer
npm run build:linux   # Linux .AppImage + .deb + .snap
```

## Features

### Terminal multiplexer
- **Split panes** — horizontal and vertical splits with resizable dividers.
- **Tabbed interface** — multiple terminals per pane, drag tabs between panes.
- **Tab reordering** — drag and drop tabs within and across groups.
- **Shell selector** — pick from auto-detected system shells (bash, zsh, fish, PowerShell, etc.) when opening a new terminal.
- **Workspace persistence** — AI session tabs are saved and restored across app restarts.

### Attention inbox
- **Notification bell** — aggregated inbox surfaces sessions that need you, with an unread badge in the title bar.
- **Event kinds** — separate signals for *waiting for approval*, *waiting for input*, and *finished*.
- **Auto-dismiss on focus** — events clear automatically when you focus the relevant tab.
- **Configurable cooldown** — tune how often a session can re-notify to avoid noise (in settings).
- **Jump-to-session** — click any inbox entry to activate its tab.

### Project management
- **Project sidebar** — add project folders, see active sessions at a glance.
- **One-click AI sessions** — start a new AI session in any project directory.
- **Pinned projects** — keep frequently used projects at the top, with an "All projects" section below.
- **Active session indicators** — see which projects have running AI sessions (both DPlex-managed and external).
- **Quick actions** — open terminal, copy path, remove project from the right-click context menu.
- **Drag-and-drop reordering** — organize projects in your preferred order.
- **Git branch display** — current branch shown per project.
- **Git worktree support** — create, manage, and remove worktrees per project, with worktree-specific session lists.

### Sessions
- **Session discovery** — automatically discovers past sessions from AI tool data directories.
- **Search & filter** — find sessions by name, ID, or summary.
- **Resume sessions** — click to resume any past session in a new terminal tab.
- **Close active sessions** — stop running AI sessions from the sidebar; closing a tab fully terminates the underlying AI process.
- **Delete sessions** — remove session data from disk.
- **Time and workspace grouping** — group sessions by recency or by workspace.
- **Prompt history viewer** — browse and search the list of prompts you've sent in any past session.

### Multi-provider support
- **Provider-agnostic architecture** — pluggable provider system for any AI CLI tool. See [docs/providers.md](./docs/providers.md).
- **Built-in providers** — Copilot CLI supported out of the box.
- **Configurable default** — choose your preferred AI tool in settings.
- **Auto-detection** — sessions know which provider they belong to for correct resume commands.

### Theming
8 built-in themes with matched terminal and UI colors:
- **Dark** — Midnight, Dracula, Monokai, Nord, Solarized Dark, GitHub Dark.
- **Light** — GitHub Light, Solarized Light.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘T` | New terminal |
| `⌘W` | Close terminal |
| `⌘B` | Toggle sidebar |
| `⌘,` | Open settings |
| `⌘\` | Split horizontal |
| `⌘⇧\` | Split vertical |
| `⌘1-9` | Switch to tab N |

## How DPlex compares

There are great tools in adjacent niches. DPlex isn't trying to replace any of them — it's optimizing for a specific workflow: **running multiple AI CLI sessions across multiple projects without losing your place.**

| Tool          | Niche                                  | Where it differs from DPlex                                          |
| ------------- | -------------------------------------- | -------------------------------------------------------------------- |
| **tmux** / **Zellij** | Terminal multiplexer, server-side | Powerful but generic; no AI-tool awareness, no project sidebar, no session discovery. |
| **Warp**      | AI-augmented terminal                  | Beautiful, but the AI is *theirs*, not the CLI tool you already use. Closed source. |
| **iTerm2** / **Wezterm** | Best-in-class terminal emulators | More polished as terminals; no orchestration of external AI sessions. |
| **VS Code terminal panel** | Embedded terminals in the IDE | Fine for ad-hoc shells; not designed for managing many concurrent AI sessions across many repos. |
| **Wave Terminal** | AI-focused terminal of the future | Adjacent vision; broader scope, more opinionated UI. DPlex is narrower and Electron-portable today. |

If your goal is "I want to run a Claude session in repo A, a Copilot session in repo B, and a regular shell in repo C, all visible at once, and I want yesterday's sessions findable tomorrow" — that's DPlex.

## FAQ / Troubleshooting

**My AI tool isn't being detected.**
Check that the binary is on the same `$PATH` that your default shell sees. DPlex spawns its PTYs via your login shell, so anything missing from `~/.zprofile` or `~/.bashrc` won't be found.

**An AI session shows as inactive even though it's running.**
DPlex detects active sessions via the tool's lock files (`inuse.<PID>.lock`). If the tool's lock format changed in an upstream release, please open an issue with your version + OS — usually a one-line fix in the provider.

**My session tabs didn't restore after a crash.**
Workspace state is saved on graceful quit and during natural lifecycle events; a hard kill (SIGKILL, OOM) can lose unsaved tabs. The session *history* is unaffected — your past sessions are still discoverable from the Sessions list.

**The app won't open on macOS — it says it's from an unidentified developer.**
Until proper notarization lands, right-click the `.app` and choose Open. macOS remembers your choice.

**I want feature X / I'd like a provider for tool Y.**
[Open an issue](https://github.com/Ron537/DPlex/issues/new/choose). For new providers there's a dedicated template — see [docs/providers.md](./docs/providers.md) if you want to send a PR.

## Architecture

DPlex uses `electron-vite` with three process targets — main (Node), preload (IPC bridge), and renderer (React).

For the deep dive — security posture, state stores, terminal lifecycle, IPC pattern, and provider system — see [**docs/architecture.md**](./docs/architecture.md).

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 39 |
| Build | electron-vite + Vite 7 |
| Frontend | React 19, TypeScript 5.9 |
| Styling | Tailwind CSS v4 |
| State | Zustand 5 |
| Terminal | xterm.js 6 (with WebGL, fit, web-links addons) |
| PTY | node-pty |
| Icons | lucide-react |
| Packaging | electron-builder + electron-updater |
| Tests | Vitest (unit) + Playwright (e2e + monkey) |

## Contributing

Contributions are welcome! Please read [**CONTRIBUTING.md**](./CONTRIBUTING.md) for the dev setup, project conventions, and PR checklist.

The fastest way to expand DPlex's reach is implementing a new
provider — see [docs/providers.md](./docs/providers.md). Bug reports
with reproduction steps are equally valuable.

## Security

Please report security vulnerabilities privately. See [**SECURITY.md**](./SECURITY.md) for the disclosure process.

## License

DPlex is open source under the [MIT License](./LICENSE).

