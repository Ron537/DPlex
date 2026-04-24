# Changelog

All notable changes to DPlex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-04-24

### Added

- Keyboard shortcut `⌘F` / `Ctrl+F` focuses the side panel search
  input. If the panel is collapsed, it auto-expands first. Works for
  any future search-enabled panel via the `dplex:focus-search` custom
  event.
- The most recently expanded project card is now emphasized with an
  accent border and subtle glow, making it easy to tell which project
  you're currently focused on when several are expanded at once.
- Terminal and AI-session tabs whose working directory matches the
  focused project (or any of its worktree children) now share the
  project's deterministic avatar color via a subtle background tint and
  a thin left strip — the active tab remains the most prominent and
  also picks up a stronger tint of the same project color.
- New `setLastExpanded` action on the project store that promotes an
  already-expanded project to be the emphasized one without toggling
  its expansion state.

### Changed

- Clicking an already-expanded project card that isn't the emphasized
  one now promotes it to "focused" instead of collapsing it. The
  chevron control still toggles expansion directly.
- The project-card chevron is now a proper `<button>` with an
  `aria-label` (`Expand project` / `Collapse project`).

## [0.3.0] — 2026-04-24

### Changed

- Sidebar redesigned in VS Code style: a vertical activity bar (44 px
  icon strip) now sits on the far left and is always visible. Clicking
  the active icon collapses the panel (icons remain); clicking another
  icon switches tabs. The panel header shows the tab title
  (`PROJECTS` / `SESSIONS`) with action icons aligned right. The
  Settings gear moved to the bottom of the activity bar.
- `⌘B` now toggles only the side panel; the activity bar stays visible.
- New settings `sidebarActiveTab` and `sidebarPanelCollapsed` persist
  the active tab and collapsed state across restarts.

## [0.2.1] — 2026-04-23

### Fixed

- Release workflow: the macOS build no longer uses the local
  `dmgbuild-wrapper.sh` (which patches around a Spotlight-holds-DMG-open
  flake that only occurs on developer machines). CI now uses a
  dedicated `build:mac:ci` script that lets electron-builder use its
  bundled dmgbuild directly.

## [0.2.0] — 2026-04-23

### Added

- Open-source release scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and pull-request templates,
  Dependabot, and CodeQL workflows.
- GitHub Actions release workflow (`release.yml`) — tag-triggered
  multi-OS build that publishes signed binaries to GitHub Releases.
- Auto-update support via `electron-updater`. Packaged builds check
  GitHub Releases on launch, download new versions in the background,
  and install on next quit.
- Architecture and provider authoring guides (`docs/architecture.md`,
  `docs/providers.md`).
- Comprehensive `README.md` overhaul with badges, alternatives
  comparison, install instructions, and FAQ.
- `CHANGELOG.md` following the Keep a Changelog format.
- Versioning and changelog policy documented in
  `.github/copilot-instructions.md`.

### Changed

- `package.json` metadata now reflects the real author, repository, and
  license.
- `electron-builder.yml` uses a real `appId` (`dev.dplex.app`),
  `productName`, maintainer, and a GitHub publish target.
- CI (`tests.yml`) split into `typecheck`, `unit-tests`, and `e2e-tests`
  jobs. Runs on Ubuntu only to stay well under the free-tier quota.

### Security

- `shell.openExternal` and `will-navigate` now validate URL schemes;
  only `http(s)` and `mailto` are allowed. Closes the classic Electron
  protocol-handler RCE vector.

## [0.1.0] — Initial public release

First public release of DPlex — a terminal multiplexer built for
AI-assisted development.

### Added

- Tabbed terminal multiplexer with split panes (xterm.js + node-pty).
- Workspace persistence: AI-session tabs restore across app restarts.
- Project sidebar with one-click AI session creation, per-project git
  branch display, pinned projects, worktree support, and drag-to-reorder.
- Session discovery for GitHub Copilot CLI with automatic active-session
  detection and PID-based session resolution.
- Attention inbox with notification bell, three event kinds
  (waiting-for-approval, waiting-for-input, finished), configurable
  cooldown, and jump-to-session.
- Prompt history viewer for past sessions.
- Pluggable provider system (`SessionProvider` interface) for adding
  new AI CLI tools.
- Eight built-in themes across dark and light variants.
- Keyboard shortcuts for tabs, splits, sidebar, and settings.

[Unreleased]: https://github.com/Ron537/DPlex/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Ron537/DPlex/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ron537/DPlex/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Ron537/DPlex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ron537/DPlex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ron537/DPlex/releases/tag/v0.1.0
