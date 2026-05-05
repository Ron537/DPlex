# Changelog

All notable changes to DPlex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Improvements

- The Projects / Sessions switcher is now a clean underline tab strip
  with count badges, replacing the segmented pill.
- Action buttons (filter, add project, refresh) sit inline with the
  tabs, freeing up vertical space.
- The Sessions panel now has a footer showing live / total counts,
  matching the Projects panel.
- Side-panel scrollbar fades out when idle and only appears while you
  hover or scroll the list.

### Bug Fixes

- A starting AI session no longer shows up twice in the project list
  (once as "Starting…" and once as the resolved session).

## [0.8.0] — 2026-05-04

### Features

- New **Dark** theme — a clean, cool-grey palette inspired by classic
  editor dark themes.

### Improvements

- Sessions and terminals inside a project are now compact single-line
  rows, so projects with many sessions stay scannable.
- The selected session or terminal row is highlighted with a soft
  background fill so the active item is easier to spot at a glance.
- Project avatars now show the highest-priority status across their
  sessions — amber when something needs your input, not just plain
  "live green".
- The collapsed project rail keeps the amber "needs input" border but
  drops the green running border, so attention pops more clearly.
- Selection highlights (project cards, session rows, active tab ring)
  now follow the active theme's accent color instead of always using
  the DPlex blue.

## [0.7.0] — 2026-05-04

### Improvements

- DPlex theme refreshed with a softer blue palette across both dark
  and light variants.
- Active tab and editor content now merge visually — no seam between
  the tab and the content area.
- The active-tab marker is now global: only the focused split group
  highlights its tab.
- Inactive split groups are subtly dimmed so the focused group is
  easier to spot.
- Search inputs adapt per theme so they stand out cleanly from the
  surrounding sidebar.

### Bug Fixes

- Status-bar chips no longer wrap to two lines when the active tab
  title is long.
- Fixed a thin gap that appeared below the terminal after resizing.
- The Settings "Done" button now uses the current accent color
  (was a leftover purple highlight).

## [0.6.0] — 2026-05-03

### Features

- Comprehensive visual refresh across the entire app — refined dark
  palette, modernized Settings modal, polished Git panel, slimmer
  status bar.
- `Cmd/Ctrl+1`–`Cmd/Ctrl+9` now switches to any tab across split
  groups, not just the active group.
- Worktrees now appear as collapsible section headers inside their
  parent project, with the parent's main checkout in its own header,
  so on-main work is easy to tell apart from worktree-scoped work.
- Project avatars show a small live-session indicator (green when an
  AI session is running, accent when there are open tabs).
- Plain terminal rows in the project sidebar are visually distinct
  from AI session rows.

### Improvements

- Right-click "Start session" on a project or worktree now uses your
  default AI tool instead of listing every installed provider.
- The active session or terminal in the sidebar gets a soft highlight
  that's easy to spot but not distracting.
- Activating a tab automatically expands the matching project in the
  sidebar and scrolls it into view.
- Worktree sections with no sessions now show the same "No active
  sessions." empty state as regular projects.
- Sessions panel branch names no longer overlap the time chip on
  long branches.

### Bug Fixes

- Clicking an expanded project row collapses it again (chevron click
  still works as before).
- "Show in Git Panel" now opens the Git panel when it was collapsed.
- The "X projects · Y active" count in the sidebar header is now
  correct on Windows and case-insensitive file systems.
- The selected file in the Git Changes list now stays highlighted.
- Light-theme color collision between two status colors fixed —
  warning labels keep their amber hue.

### Performance

- Smoother Git Changes panel during heavy file activity.
- "Refreshing…" indicator no longer flickers on background refreshes;
  it only appears on the initial load.

## [0.5.0] — 2026-05-02

### Features

- Collapsing the sidebar now turns it into a vertical rail of project
  avatars instead of disappearing. Click an avatar to re-expand and
  switch to that project.
- Smooth animated transition between the expanded sidebar and the
  collapsed avatar rail.
- New in-panel Projects/Sessions toggle replaces the old standalone
  activity bar.
- Project avatars indicate status at a glance: dimmed when idle,
  full opacity when live, green pulsing border when an agent is
  running, amber when something needs your attention.
- Activating a tab also selects the matching project in the sidebar;
  clicking a project jumps to its first open tab.
- New right-side Git panel that follows the active project, with a
  Changes section, worktree switcher, and clear empty/error states
  for non-standard repo states (detached HEAD, mid-merge, mid-rebase,
  mid-cherry-pick, mid-bisect). Toggle with `Cmd/Ctrl+Shift+G`.
- VS Code–style preview tabs in the Git panel: single-click to
  preview, double-click to pin.
- Per-file diff tabs with side-by-side / inline toggle, syntax
  highlighting, and live refresh as the working tree changes.
- Sessions panel "Collapse / Expand all groups" toolbar button.
- DPlex now reopens the project that was active when you last quit.
- **Claude Code** is now supported alongside Copilot CLI.
- Staged / Unstaged toggle in the diff viewer for files with both
  kinds of changes.
- Diff viewer minimap and overview ruler — see all changes in long
  files at a glance.

### Improvements

- Active-project indicator switched to a thin accent bar — clearer
  and matches the collapsed-rail look.
- Tabs no longer get tinted with the focused project's color, making
  the focused tab easier to read.
- Discovered project rows get a subtle dim + badge instead of a
  dashed border.
- Settings: Session Max Age range now caps at 15 days.
- Git panel collapsed strip redesigned in VS Code activity-bar style,
  with a branch glyph and a changed-file count badge that's visible
  even when the panel is collapsed.
- "View Changes" project context-menu entry renamed to "Show in
  Git Panel" and now opens the panel directly.

### Bug Fixes

- Active-project indicator and click-to-focus work correctly on
  Windows and case-insensitive file systems.
- Git panel now shows the worktree's own changes when a worktree
  child is the active project (was showing the parent repo's).
- Diff viewer updates correctly on consecutive saves to the same
  file.
- Diff viewer works correctly on linked worktrees — file watches
  now fire as expected.
- Switching files in the diff viewer no longer briefly shows the old
  file's content under the new file's language.
- Conflicted files during a merge now show a meaningful diff instead
  of an empty pane.
- Diff viewer no longer flickers on background refreshes — scroll
  position, cursor, and selection are preserved.
- Tightened session-id validation to reject crafted filenames in
  session directories that could otherwise execute shell commands
  when clicking Resume.
- Diff viewer rejects writes that would escape the repo via
  symlinks.

### Performance

- Faster, smoother Git Changes updates — the watcher now respects
  `.gitignore`, so build outputs no longer keep the panel in a
  perpetual refresh.
- Smaller cold-start bundle: the Monaco editor is loaded only when
  you open your first diff.
- Reduced sidebar re-renders.

## [0.4.0] — 2026-04-24

### Features

- New `Cmd/Ctrl+F` shortcut focuses the sidebar search (auto-expands
  the panel if collapsed).
- The most recently expanded project is highlighted with an accent
  border so it's easy to tell which project you're focused on.
- Tabs whose working directory matches the focused project pick up
  that project's color — the active tab gets a stronger tint.

### Improvements

- Clicking an already-expanded project that isn't the focused one
  now promotes it instead of collapsing (the chevron still toggles).
- Project chevron is now a proper button with screen-reader labels.

## [0.3.0] — 2026-04-24

### Features

- VS Code–style sidebar with a vertical activity bar always visible
  on the left. Click the active icon to collapse the panel; click
  another icon to switch between Projects and Sessions.
- The Settings gear moved to the bottom of the activity bar.
- DPlex now remembers your active sidebar tab and collapsed state
  across restarts.

### Improvements

- `Cmd/Ctrl+B` now toggles only the side panel; the activity bar
  stays visible.

## [0.2.1] — 2026-04-23

### Bug Fixes

- Fixed macOS DMG build failures so packaged macOS releases ship
  reliably.

## [0.2.0] — 2026-04-23

### Features

- **Auto-updates**: packaged builds now check for new versions on
  launch and install them on next quit.
- DPlex is now open source under MIT, with signed multi-OS binaries
  published to GitHub Releases.

### Bug Fixes

- Closed a security vector around opening external links.

## [0.1.0] — Initial public release

First public release of DPlex — a terminal multiplexer built for
AI-assisted development.

### Features

- Tabbed terminal multiplexer with split panes.
- Workspace persistence: AI session tabs restore across app
  restarts.
- Project sidebar with one-click AI session creation, per-project
  Git branch display, pinned projects, worktree support, and
  drag-to-reorder.
- GitHub Copilot CLI session discovery, active-session detection,
  and Resume.
- Attention inbox with a notification bell for sessions waiting on
  approval, waiting for input, or finished.
- Prompt-history viewer for past sessions.
- Pluggable provider system for adding new AI CLI tools.
- Eight built-in themes (dark and light variants).
- Keyboard shortcuts for tabs, splits, sidebar, and settings.

[Unreleased]: https://github.com/Ron537/DPlex/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Ron537/DPlex/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Ron537/DPlex/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Ron537/DPlex/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Ron537/DPlex/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Ron537/DPlex/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ron537/DPlex/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Ron537/DPlex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ron537/DPlex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ron537/DPlex/releases/tag/v0.1.0
