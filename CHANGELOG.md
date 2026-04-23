# Changelog

All notable changes to DPlex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ron537/DPlex/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Ron537/DPlex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ron537/DPlex/releases/tag/v0.1.0
