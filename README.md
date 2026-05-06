<div align="center">

# DPlex

**A terminal multiplexer built for AI-assisted development.**

DPlex is a desktop terminal app that manages multiple AI CLI tool sessions alongside regular terminals — all in one window. Think of it as a purpose-built workspace for developers who run **Copilot CLI**, **Claude Code**, or other AI coding agents daily across many projects.

[![Tests](https://github.com/Ron537/DPlex/actions/workflows/tests.yml/badge.svg)](https://github.com/Ron537/DPlex/actions/workflows/tests.yml)
[![CodeQL](https://github.com/Ron537/DPlex/actions/workflows/codeql.yml/badge.svg)](https://github.com/Ron537/DPlex/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/Ron537/DPlex?include_prereleases&sort=semver)](https://github.com/Ron537/DPlex/releases)
[![Downloads](https://img.shields.io/github/downloads/Ron537/DPlex/total)](https://github.com/Ron537/DPlex/releases)
[![Issues](https://img.shields.io/github/issues/Ron537/DPlex)](https://github.com/Ron537/DPlex/issues)
[![Discussions](https://img.shields.io/github/discussions/Ron537/DPlex)](https://github.com/Ron537/DPlex/discussions)

[Quick install](#quick-install) · [Features](#features) · [Screenshots](#screenshots) · [How DPlex compares](#how-dplex-compares) · [Architecture](./docs/architecture.md) · [Add a provider](./docs/providers.md) · [Privacy](./PRIVACY.md) · [Contributing](./CONTRIBUTING.md)

</div>

<p align="center">
  <img src="./docs/assets/demo.gif" alt="DPlex demo: switching between Projects, Sessions, and Source Control views with a live AI session running in the editor pane" width="900" />
</p>

> **🚧 Pre-1.0.** DPlex is functional and used daily by its author, but
> APIs, settings layout, and on-disk formats may shift between minor
> versions while we feel out the right shape. Please pin your version
> and read the [CHANGELOG](./CHANGELOG.md) before upgrading.

---

## Why DPlex?

When working with AI CLI tools across multiple projects, you end up with a mess of terminal windows — a Copilot session here, a Claude session there, plus regular shells scattered everywhere. DPlex gives you one home for all of it:

- **One window** with split panes, tabs, and an activity bar (Projects · Sessions · Source Control).
- **Automatic session discovery** — sees active and past AI sessions across providers without manual tracking.
- **Session persistence** — close the app, reopen it, your AI sessions resume where you left off.
- **Project-aware workflow** — group sessions by project, start a new AI session in any folder with one click.
- **Worktree-friendly** — first-class Git worktree support so concurrent feature work doesn't pollute your main checkout.
- **Built-in Source Control** — VSCode-style changes view scoped to whichever project (or worktree) you pick.
- **No telemetry. No analytics.** Read [PRIVACY.md](./PRIVACY.md) — it's a one-page promise, backed by `grep`-able source.

## Quick install

> **Note:** DPlex binaries are currently **unsigned** while we wait on
> Apple Developer / Windows code-signing certificates. The app is open
> source and the build is fully reproducible from source — see
> [Verify the build](#verify-the-build) below.

### macOS

```bash
# Apple Silicon
curl -L https://github.com/Ron537/DPlex/releases/latest/download/DPlex-arm64.dmg -o DPlex.dmg
# Intel
curl -L https://github.com/Ron537/DPlex/releases/latest/download/DPlex-x64.dmg -o DPlex.dmg

# Open the DMG, drag DPlex to /Applications, then on first launch:
xattr -dr com.apple.quarantine /Applications/DPlex.app
open /Applications/DPlex.app
```

The `xattr` line removes the macOS quarantine flag once you've inspected
the build — equivalent to right-clicking the app and choosing **Open**,
but cleaner from the terminal.

### Windows

Download `DPlex-Setup.exe` from the [Releases page](https://github.com/Ron537/DPlex/releases/latest)
and run it. SmartScreen will warn you about the unsigned installer —
click **More info → Run anyway** after verifying the file's SHA-256
matches the value published on the release page.

```powershell
Invoke-WebRequest -Uri https://github.com/Ron537/DPlex/releases/latest/download/DPlex-Setup.exe -OutFile DPlex-Setup.exe
.\DPlex-Setup.exe
```

### Linux

```bash
# AppImage (any distro)
curl -L https://github.com/Ron537/DPlex/releases/latest/download/DPlex.AppImage -o DPlex.AppImage
chmod +x DPlex.AppImage
./DPlex.AppImage

# Debian / Ubuntu
curl -LO https://github.com/Ron537/DPlex/releases/latest/download/DPlex-amd64.deb
sudo dpkg -i DPlex-amd64.deb
```

### Run from source

Requires **Node.js 18+** (we develop on 22 LTS) and Git.

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

### Verify the build

Every release is built from a tagged commit by GitHub Actions. To
reproduce locally:

```bash
git checkout v0.9.0          # or whichever release you want
npm ci --ignore-scripts
npm run build
# Compare the SHA-256 of your local build with the release's published checksums.
```

CI logs and SBOMs are attached to every release.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <a href="./docs/assets/01-hero-projects.png"><img src="./docs/assets/01-hero-projects.png" alt="Projects view with worktrees and a running AI session" /></a>
      <br><sub><b>Projects view.</b> Pinned projects + worktrees + nested AI sessions, one click away.</sub>
    </td>
    <td align="center" width="50%">
      <a href="./docs/assets/02-sessions-panel.png"><img src="./docs/assets/02-sessions-panel.png" alt="Sessions panel with active and historical AI sessions" /></a>
      <br><sub><b>Sessions panel.</b> Every Copilot CLI / Claude Code session you've ever started, searchable.</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="./docs/assets/03-source-control.png"><img src="./docs/assets/03-source-control.png" alt="Source Control panel showing git changes" /></a>
      <br><sub><b>Source Control.</b> VSCode-style changes for the selected project — pick any worktree from the dropdown.</sub>
    </td>
    <td align="center">
      <a href="./docs/assets/06-project-picker.png"><img src="./docs/assets/06-project-picker.png" alt="Project picker dropdown listing every project and worktree" /></a>
      <br><sub><b>Project picker.</b> Switch the Source Control view to any project or worktree without leaving Git.</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="./docs/assets/07-split-screen.png"><img src="./docs/assets/07-split-screen.png" alt="Split panes — three terminals visible at once" /></a>
      <br><sub><b>Splits & tabs.</b> Horizontal + vertical splits with multiple AI sessions running side-by-side.</sub>
    </td>
    <td align="center">
      <a href="./docs/assets/08-worktrees-settings.png"><img src="./docs/assets/08-worktrees-settings.png" alt="Worktree creation defaults in Settings" /></a>
      <br><sub><b>Worktree defaults.</b> Location pattern, env files, post-create scripts — set once, reused everywhere.</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="./docs/assets/04-settings-notifications.png"><img src="./docs/assets/04-settings-notifications.png" alt="Notification settings with per-event toggles" /></a>
      <br><sub><b>Notification controls.</b> Per-event toggles, Do Not Disturb, focus-aware suppression.</sub>
    </td>
    <td align="center">
      <a href="./docs/assets/05-light-theme.png"><img src="./docs/assets/05-light-theme.png" alt="Same projects view in light theme" /></a>
      <br><sub><b>Light themes too.</b> GitHub Light, Solarized Light, Quiet Light — terminal palette and UI stay in sync.</sub>
    </td>
  </tr>
</table>

## Features

### Activity bar — Projects · Sessions · Source Control

- **VSCode-style activity bar** on the far left. One click jumps between projects, sessions, and git changes.
- **Click the active item to collapse the panel** for maximum editor space.
- **Settings gear** at the bottom of the activity bar for quick access.

### Multi-provider AI sessions

- **Provider-agnostic architecture.** Built-in support for **GitHub Copilot CLI** and **Anthropic Claude Code** out of the box.
- **One interface for all providers.** Same start / resume / close flow regardless of the underlying tool.
- **Pluggable.** Add a provider by implementing one TypeScript interface — see [docs/providers.md](./docs/providers.md). PRs welcome.
- **Auto-detection.** Sessions remember which provider they belong to so resume commands are always correct.

### Terminal multiplexer

- **Split panes** — horizontal and vertical splits with resizable dividers.
- **Tabbed interface** — multiple terminals per pane, drag tabs between panes.
- **Tab reordering** — drag and drop within and across groups.
- **Shell selector** — pick from auto-detected system shells (bash, zsh, fish, PowerShell, etc.) when opening a new terminal.
- **Workspace persistence** — AI session tabs are saved and restored across app restarts.

### Project management

- **Project sidebar** with active session indicators and Git branch badge.
- **One-click AI sessions** in any project directory.
- **Pinned projects** float to the top, with an "All projects" section below.
- **Drag-and-drop reordering** for projects.
- **Quick actions** — open terminal, copy path, remove project from the right-click menu.
- **Git worktrees** — create, manage, remove worktrees per project, with worktree-specific session lists. Worktrees are first-class projects in the sidebar.

### Source Control

- **Project-scoped changes view** — file list for whichever project (or worktree) you've selected.
- **Header dropdown** to switch projects without leaving Git.
- **Single-click preview** + **double-click promotes to a permanent diff tab** (VSCode behavior).
- **Live updates** via filesystem watchers — changes appear as you save.

### Sessions

- **Session discovery** — automatically discovers past sessions from each provider's data directory.
- **Search & filter** — by name, ID, or summary.
- **Resume** — click to resume any past session in a new terminal tab.
- **Close active sessions** — stop running AI sessions from the sidebar; closing a tab fully terminates the underlying process.
- **Delete sessions** — remove session data from disk.
- **Time and workspace grouping** — group by recency or by workspace.
- **Prompt history viewer** — browse and search the prompts you've sent in any past session.

### Attention inbox

- **Notification bell** — aggregated inbox surfaces sessions that need you, with an unread badge in the title bar.
- **Event kinds** — separate signals for *waiting for approval*, *waiting for input*, and *finished*.
- **Auto-dismiss on focus** — events clear when you focus the relevant tab.
- **Configurable cooldown** — tune how often a session can re-notify to avoid noise.
- **Jump-to-session** — click any inbox entry to activate its tab.

### Theming

12 built-in themes with matched terminal and UI colors:

- **Dark** — DPlex, Dark, Midnight, Dracula, Monokai, Nord, Solarized Dark, GitHub Dark.
- **Light** — DPlex Light, GitHub Light, Solarized Light, Quiet Light.

### Keyboard shortcuts

| Shortcut | Action                       |
| -------- | ---------------------------- |
| `⌘T`     | New terminal                 |
| `⌘W`     | Close terminal               |
| `⌘B`     | Toggle sidebar               |
| `⌘,`     | Open settings                |
| `⌘\`     | Split horizontal             |
| `⌘⇧\`    | Split vertical               |
| `⌘⇧G`    | Toggle Source Control view   |
| `⌘F`     | Focus side-panel search      |
| `⌘1-9`   | Switch to tab N              |

(`⌘` = `Ctrl` on Linux/Windows.)

## How DPlex compares

There are great tools in adjacent niches. DPlex isn't trying to replace any of them — it's optimizing for one specific workflow: **running multiple AI CLI sessions across multiple projects without losing your place.**

| Tool                       | Niche                                  | Where it differs from DPlex                                                                            |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **tmux** / **Zellij**      | Terminal multiplexer, server-side      | Powerful but generic; no AI-tool awareness, no project sidebar, no session discovery.                  |
| **Warp**                   | AI-augmented terminal                  | Beautiful, but the AI is *theirs*, not the CLI tool you already use. Closed source.                    |
| **iTerm2** / **WezTerm**   | Best-in-class terminal emulators       | More polished as terminals; no orchestration of external AI sessions.                                  |
| **VS Code terminal panel** | Embedded terminals in the IDE          | Fine for ad-hoc shells; not designed for managing many concurrent AI sessions across many repos.       |
| **Wave Terminal**          | AI-focused terminal                    | Adjacent vision; broader scope, more opinionated UI. DPlex is narrower and Electron-portable today.    |
| **Zed / Cursor**           | AI-native editors                      | They embed the AI in the editor; DPlex orchestrates the AI you already use from the terminal.          |

If your goal is "I want to run a Claude session in repo A, a Copilot session in repo B, and a regular shell in repo C, all visible at once, and yesterday's sessions findable tomorrow" — that's DPlex.

## FAQ / Troubleshooting

**My AI tool isn't being detected.**
Check that the binary is on the same `$PATH` your default shell sees. DPlex spawns its PTYs via your login shell, so anything missing from `~/.zprofile` or `~/.bashrc` won't be found.

**An AI session shows as inactive even though it's running.**
DPlex detects active sessions via the tool's lock files (`inuse.<PID>.lock` for Copilot, pidfiles for Claude). If the tool's lock format changed in an upstream release, please open an issue with your version + OS — usually a one-line fix in the provider.

**My session tabs didn't restore after a crash.**
Workspace state is saved on graceful quit and during natural lifecycle events; a hard kill (SIGKILL, OOM) can lose unsaved tabs. The session *history* is unaffected — your past sessions are still discoverable from the Sessions list.

**The app won't open on macOS — "DPlex is damaged" or "from an unidentified developer."**
Until proper notarization lands, run:

```bash
xattr -dr com.apple.quarantine /Applications/DPlex.app
```

…or right-click the app and choose **Open**. macOS remembers your choice after the first launch.

**The Windows installer is flagged by SmartScreen.**
Until code signing lands: click **More info → Run anyway** after verifying the SHA-256 matches the release page. The installer is unmodified from CI.

**I want feature X / I'd like a provider for tool Y.**
[Open an issue](https://github.com/Ron537/DPlex/issues/new/choose). For new providers there's a dedicated template — see [docs/providers.md](./docs/providers.md) if you want to send a PR.

## Architecture

DPlex uses `electron-vite` with three process targets — main (Node), preload (IPC bridge), and renderer (React).

For the deep dive — security posture, state stores, terminal lifecycle, IPC pattern, and provider system — see [**docs/architecture.md**](./docs/architecture.md).

## Tech stack

| Layer       | Technology                                                                  |
| ----------- | --------------------------------------------------------------------------- |
| Framework   | Electron 39                                                                 |
| Build       | electron-vite + Vite 7                                                      |
| Frontend    | React 19, TypeScript 5.9                                                    |
| Styling     | Tailwind CSS v4                                                             |
| State       | Zustand 5                                                                   |
| Terminal    | xterm.js 6 (with WebGL, fit, web-links addons)                              |
| PTY         | node-pty                                                                    |
| Icons       | lucide-react                                                                |
| Packaging   | electron-builder + electron-updater                                         |
| Tests       | Vitest (unit) + Playwright (e2e + monkey)                                   |

## Contributing

Contributions are very welcome. Read [**CONTRIBUTING.md**](./CONTRIBUTING.md) for the dev setup, conventions, and PR checklist.

The fastest way to expand DPlex's reach is **implementing a new provider** — see [docs/providers.md](./docs/providers.md). Bug reports with reproduction steps are equally valuable.

Looking for something to start with? Browse [issues labelled `good first issue`](https://github.com/Ron537/DPlex/labels/good%20first%20issue).

## Privacy & security

- **No telemetry, ever.** Read [PRIVACY.md](./PRIVACY.md) — it's auditable.
- Report security issues privately per [SECURITY.md](./SECURITY.md).

## License

DPlex is open source under the [MIT License](./LICENSE).

---

<div align="center">
  <sub>Built with ❤️ by developers who got tired of having 14 terminal windows open.</sub>
</div>
