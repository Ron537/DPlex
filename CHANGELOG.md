# Changelog

All notable changes to DPlex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Right-side Git panel.** Auto-binds to the active project and hosts a
  collapsible **Changes** section. Replaces the standalone "View Changes"
  diff tab. Toggle with **Cmd/Ctrl+Shift+G** (suppressed in inputs and
  the Monaco find widget). Defaults to collapsed but the watcher stays
  alive so the count badge in the collapsed strip is always accurate.
- Git panel: **VS Code-style preview tabs.** Single-click a changed file
  opens a preview tab (italic title) in the active editor group; clicking
  another file replaces the preview slot in place. Double-click the file
  in the panel — or the tab title itself — promotes it to a permanent
  tab. Preview tabs are not persisted across restarts; permanent file
  diff tabs are.
- Git panel: **Worktree switcher** that lists the project-registered
  worktrees only (hidden when ≤ 1). Selection is per-project and
  validated on every refresh — falls back to the project root if the
  active worktree is removed.
- Git panel: **First-class empty / error states** dispatched on a new
  `diff:getRepoStatus` IPC: not-a-repo, missing-path, detached HEAD,
  mid-merge, mid-rebase, mid-cherry-pick, mid-bisect, generic error.
- **Per-file diff tabs** (`kind: 'fileDiff'`) powered by Monaco's
  `DiffEditor` with side-by-side ⇄ inline toggle, syntax highlighting,
  and live refresh as the working tree changes. Forces inline mode for
  newly-created files (one side empty). Read-only in v1.
- Diff viewer: **Staged / Unstaged toggle** in the bottom-left of the
  editor pane for files that have changes in both the index and the
  working tree (porcelain status `MM`, `MD`, `AM`, etc.), so both
  halves of the change can be inspected without leaving the tab.
- Diff viewer: refreshes the changes list and selected diff when the
  app window regains focus or becomes visible, so changes made in an
  external editor show up immediately on Linux where `fs.watch` can
  miss deep edits.
- Git panel collapsed strip redesigned in VS Code activity-bar style: a
  44 px rail with a 36 × 36 icon button, branch glyph, accent stripe,
  and corner count badge that surfaces the changed-file count even
  when the panel is collapsed.
- Diff viewer: enabled Monaco's minimap (with hunk-tinted overlay) and
  overview ruler so changes in long files are visible on the scrollbar
  without scrolling. Also lowered the side-by-side ⇄ inline breakpoint
  from 900 px to 600 px (and disabled Monaco's internal auto-fallback)
  so split view stays available on narrower panels.
- Sessions panel: **Collapse / Expand all groups** toolbar button that
  toggles every group at once in both grouping modes (Time and
  Workspace). Individual group toggles still work in between presses.
- **Persist last active project across app restarts.** Reopening the
  app re-selects the project that was active when you last quit, and
  walks the parent-project chain so the row is actually visible (e.g.
  worktree children expand their parent automatically). Collapsing the
  active project (or any ancestor of an active worktree child) clears
  the persisted selection so the next launch starts fresh.

### Changed

- Diff watcher: **`.gitignore`-aware filtering.** Replaces the previous
  hardcoded "noisy directory" list with a per-repo matcher built from
  every `.gitignore` in the worktree, plus `.git/info/exclude` and the
  user's global `core.excludesfile`. Events under ignored paths are
  dropped before triggering a `git status`, so build outputs and tooling
  caches that the old list didn't know about (Rust `target/`, Bazel
  outputs, custom log dirs, etc.) no longer keep the panel in a
  perpetual refresh. Hardened against hostile input (`.gitignore`
  symlinks rejected, 1 MiB size cap, 5 s `git config` timeout) and
  defers matcher construction off the IPC critical path so subscribing
  never blocks on a large-repo walk. The matcher is rebuilt
  automatically (debounced) when any `.gitignore`, `.git/info/exclude`,
  or the user's global excludes file changes; linked worktrees follow
  the `commondir` pointer to find the shared `info/exclude`.
- The standalone repo-level `diff` tab kind is removed; opening changes
  is now exclusively through the Git panel. The project context menu
  entry is renamed **View Changes → Show in Git Panel**, which expands
  the panel and binds to that project. Legacy `kind: 'diff'` entries in
  persisted workspaces are quietly dropped on restore.
- Editor groups gained a `previewTabId` invariant (always undefined or
  pointing at an existing tab), kept in sync across close, move, split,
  and restore mutations.

### Fixed

- (Internal) Generation-based stale-response protection in the Git
  panel store so a slow `diff:listChanges` from a previous project
  cannot overwrite the cache after the user switches projects.

### Fixed

- Diff viewer no longer fails to update the editor pane when a file
  is edited again while already selected (e.g. consecutive saves to
  the same file). The changes-list dedup that was meant to suppress
  needless "Refreshing…" spinners was also suppressing the editor
  re-fetch — content-change detection is now decoupled from the
  list-signature check.
- Diff viewer now resolves the watcher's `.git` directory through the
  `gitdir:` pointer when a project is a **linked worktree**, so file
  watches actually fire (previously the watcher was looking at a
  non-existent `.git/HEAD` inside the worktree).
- Diff viewer: per-WebContents subscription counts are now released
  in full on tab/window destroy. A single tab subscribing to several
  diff scopes for the same repo no longer leaves dangling watcher
  refs after close.
- Diff viewer: hunk patches now emit `\ No newline at end of file`
  markers when either side lacks a trailing newline, so
  `git apply --check` accepts patches over files without a trailing
  newline (previously the apply would silently fail).
- Diff viewer: conflicted files (`UU`/`AA`/`DD`) now fall back from
  stage 0 to stage 2 (`ours`) and then `HEAD` when reading the left
  side, so the diff renders meaningful content during a merge instead
  of showing an empty pane.
- Diff viewer: the `diff:saveWorkingFile` IPC handler now realpaths
  the parent directory (and the file itself, when it exists) and
  rejects writes that would escape the repo root via a symlink.
- Diff viewer: `safeScope` rejects refs starting with whitespace or
  `-` and refs containing NUL, defense-in-depth against argv-style
  flag injection.
- Diff viewer: switching files in the editor pane no longer briefly
  shows the previous file's content under the new file's language —
  content is cleared synchronously on selection change.
- Diff viewer: eliminated the editor flicker that occurred on every
  background watcher refresh. The editor now reuses Monaco's diff
  models via `setValue()` when the same file is re-fetched (preserves
  scroll position, cursor, and selection); content is no longer
  cleared to empty on refresh; byte-identical refetches are skipped
  entirely; and the "Loading…" badge only appears on the initial
  load or when the selected file changes — not on background refreshes.
- Git panel: showed the parent repo's changes when a worktree child
  was active. The vestigial `gitPanelState.activeWorktreeRoot` field —
  never written by current code but persisted by older builds with the
  parent's path on worktree children — caused the panel to resolve to
  the parent repo. Removed the field, simplified the active-root
  resolver to just use the project's path, and added a one-shot
  migration in `loadProjects` that strips the legacy field on load and
  re-persists the cleaned project list.
- Diff viewer: disabled Monaco's F1 command palette and right-click
  context menu in the diff editor. Both surfaced edit/refactor actions
  that aren't applicable to DPlex's read-only diff view and were a
  source of confusion.

### Added (continued)

- New `git:listChanges`, `git:fileDiffContent`, `git:listBranches`,
  `git:stage*/unstage*/discard*/revert*/applyHunk` IPC channels for
  full SCM parity (renderer hookup is partial in v1).
- Monaco editor lazy-loaded on first diff tab open — keeps the cold
  start bundle small (~1.4 MB main chunk; ~6 MB Monaco loaded only
  when needed). CSP relaxed to allow `worker-src 'self' blob:` for
  Monaco's language workers.

- **Claude Code provider.** DPlex now discovers, monitors, resumes,
  closes, and deletes sessions from the `claude` CLI alongside Copilot
  CLI. Sessions live at `~/.claude/projects/<slug-of-cwd>/<id>.jsonl`,
  and live status is read from the per-process pidfile registry at
  `~/.claude/sessions/<pid>.json`. Live status maps to dplex's existing
  status taxonomy: `waiting` + `approve …` → awaitingApproval, `busy` +
  tool detail → executingTool, `busy` (no tool) → thinking, `idle` →
  idle, and `tempo: blocked` → waitingForUser. `approve AskUserQuestion`
  is treated as `waitingForUser` since it's an interactive question
  rather than a side-effecting permission gate.
- New `processUtils` module sharing `killProcess`, `isProcessAlive`,
  and `waitForProcessesToExit` between providers.

### Changed

- **`BaseSessionProvider` refactor** to support providers whose storage
  shape doesn't match Copilot CLI's "one directory per session + lock
  files" convention. New `SessionEntry` abstraction and overridable
  hooks (`listSessionEntries`, `getEntryForSessionId`,
  `getActivePidsForEntry`, `parseSession`, `removeSessionData`,
  `sessionIdFromWatchPath`, `pushSessionUpdate`) allow alternative
  storage layouts. Copilot provider behavior is unchanged.

### Security

- **Tightened `validateSessionId`** to a strict `[A-Za-z0-9_-]+`
  charset (max 128 chars). Previously only `/`, `\`, and `..` were
  rejected, leaving shell metacharacters (`;`, `$()`, backticks, `|`,
  `&&`, whitespace) free to slip through. A malicious tarball or
  project that planted a crafted filename under `~/.claude/projects/`
  or `~/.copilot/` could otherwise execute arbitrary shell when the
  user clicked Resume. Discovered entries with invalid ids are now
  filtered out at discovery time as well as at resolve time.

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
