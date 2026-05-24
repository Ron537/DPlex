# Changelog

All notable changes to DPlex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.0] — 2026-05-24

### Features

- Type `@ # [ ] { } \ |` in the terminal on Spanish, French, German and
  other non-US macOS keyboards (⌥+Arrow keys keep working).

### Bug Fixes

- Truecolor themes (e.g. Neovim with `termguicolors`) now render with
  correct colors instead of a shifted green/yellow tint.

## [0.17.2] — 2026-05-21

### Performance

- Dramatically reduced UI lag and freezes when multiple AI sessions produce output simultaneously.
- Terminal output is now batched before delivery, preventing IPC flooding under heavy load.
- Added flow control so fast-producing terminals automatically throttle when the display falls behind.

## [0.17.1] — 2026-05-20

### Bug Fixes

- Copilot CLI sessions waiting for tool approval now correctly show **Needs approval** status instead of **Running**.

## [0.17.0] — 2026-05-18

### Features

- Every pane now wears a **breadcrumb header** under its tab bar
  showing the active tab's project avatar, project name, working
  directory, branch, and (for AI sessions) the provider and live
  status — so context never lives only in a tab title.
- Tabs now show a project **avatar with the project's initials** —
  scan a busy row and see at a glance which project each tab
  belongs to, even after manual reordering. Worktree tabs share
  their parent repo's avatar.
- New **Focus project** filter dims tabs that don't belong to the
  active project, right from the status bar. Tab order, splits,
  and running sessions stay exactly as they were — click the pill
  again to clear.

## [0.16.0] — 2026-05-13

### Features

- Tag your projects to group related ones together, then filter the
  projects sidebar with one click on a tag chip. Right-click a project
  → **Tags…** to add, remove, or create tags.
- Pick a color for each tag from an 8-swatch palette (or let DPlex
  assign one automatically). Tag colors are shared across the sidebar
  and command palette, so the same tag always looks the same.
- Global search (⌘P) now matches projects by tag — type `#infra` to
  filter, or just type a tag name. Each project result shows its
  avatar and tag pills so you can see why it matched.
- New **Search** button in the status bar opens the command palette,
  with its ⌘P shortcut shown right on the button.

### Improvements

- Filtering projects by tag keeps a parent's worktree branches visible
  underneath it, so a tag on the origin pulls the whole tree along.
- Project rows fit as many tag pills as actually have room, then
  surface the rest as a `+N` chip whose tooltip lists what's hidden —
  nothing is silently clipped.

## [0.15.0] — 2026-05-12

### Features

- Attention bell can now mark waiting notifications as seen when you
  click them, matching Slack/Gmail-style behavior. A mode pill at the
  top of the bell dropdown ("View only" / "Mark seen on click") shows
  the current behavior and toggles it with one click; the same setting
  also lives under Settings → Notifications. Off by default — when on,
  clicking a waiting row both jumps to the tab and clears the badge,
  and the bell will re-surface the event if the session keeps waiting.

## [0.14.2] — 2026-05-11

### Bug Fixes

- macOS builds now ship with a valid ad-hoc code signature, so the
  Electron framework loads cleanly on macOS 14+ and the "DPlex is
  damaged" Gatekeeper error no longer appears. Previous builds were
  published completely unsigned. (You may still need
  `xattr -dr com.apple.quarantine /Applications/DPlex.app` on first
  launch until a Developer ID signature is in place.)

## [0.14.1] — 2026-05-11

### Bug Fixes

- DPlex on Intel Macs now launches AI sessions correctly. The previous
  Intel build shipped wrong-architecture native binaries, so every new
  session failed silently with no usable error in the UI.

## [0.14.0] — 2026-05-10

### Improvements

- Polished, fully responsive GitHub Pages site with a dedicated
  Changelog page that auto-generates from `CHANGELOG.md` on every
  push — search engines now index every release directly. Mobile nav,
  reflowed compare table, FAQ section, structured data, sitemap, and
  `robots.txt` round out the SEO refresh.

## [0.13.0] — 2026-05-10

### Features

- AI session tabs now show a live status dot — the same colors used in
  the sidebar — so you can tell at a glance whether a background tab is
  thinking, running a tool, or waiting on you, without switching to it.
  Idle tabs stay quiet.

## [0.12.0] — 2026-05-09

### Features

- New global search palette (Cmd/Ctrl+P) for finding projects,
  sessions, open tabs, settings, and actions in one place. Results
  are grouped by type with keyboard navigation.
- Cmd/Ctrl+Shift+P opens a command runner filtered to actions —
  add a project, toggle the sidebar, switch views, and more.
- New Search view in the activity bar mirrors the palette as a
  persistent side panel.
- Searching for a setting jumps straight to the right Settings tab
  and pulse-highlights the row.

## [0.11.3] — 2026-05-09

### Bug Fixes

- Copilot CLI sessions now show their real title in the sidebar
  again. Recent Copilot CLI versions write the session name to
  `workspace.yaml` instead of `plan.md`, so older builds of DPlex
  fell back to displaying truncated session ids for both active and
  idle sessions.
- Sessions sidebar now reflects the live tab title — the project list
  and active-session rows update as soon as the AI tool renames the
  tab on its first response, and stay updated instead of snapping
  back to the session id while the on-disk name catches up.
- Desktop notifications no longer silently drop when a session changes
  attention type quickly (e.g. finishing right before asking for
  approval). The cooldown now applies per attention type and never
  blocks idle-too-long reminders.

## [0.11.2] — 2026-05-07

### Performance

- Faster app startup and rendering from refreshed Electron, React,
  and Monaco editor versions.

## [0.11.1] — 2026-05-07

### Improvements

- README, GitHub Pages site, and architecture doc now lead with
  AI session management — discover every past Copilot CLI / Claude
  Code session, resume any of them in one click, close active ones
  from the sidebar, delete history from disk, and have every session
  tab auto-restore exactly where you left it the next time you open
  the app.
- Demo animation now showcases the headline workflow: opening the
  Sessions panel, resuming a past session in one click, and chatting
  with the resumed Copilot session.

## [0.11.0] — 2026-05-07

### Features

- Auto-update: DPlex now checks for new releases on launch and every
  6 hours. On Windows and Linux AppImage, updates download silently
  in the background and a banner offers a one-click "Restart and
  install". On macOS and Linux `.deb` builds (where in-place
  replacement isn't safe yet) the banner instead links to the
  release page; you can also "Skip this version" to stop being
  prompted for that release.
- New "About" tab in Settings shows the current version, last update
  check time, and a manual "Check for updates" button.

## [0.10.0] — 2026-05-07

### Features

- Recent sessions per project: each expanded project (and worktree
  section) now lists your last few idle sessions inline, so you can
  resume them without leaving the projects panel. Click a row to
  resume; rows are styled as muted "history" entries and respect the
  "Hide sessions with no messages" setting.
- New settings under Sessions to toggle the recent-sessions list and
  pick how many to show (1–5, default 3).

## [0.9.2] — 2026-05-07

### Bug Fixes

- Drop `snap` from Linux release targets — Ubuntu CI runners don't
  ship `snapcraft` and the resulting `app-builder` failure was
  blocking the entire Linux release. AppImage and `.deb` still ship.
- Make the `actions/attest-build-provenance` step non-blocking so
  builds still publish on user-owned private repos (GitHub's
  attestation API isn't available there). The step starts working
  automatically once the repo is public.

## [0.9.1] — 2026-05-07

### Improvements

- Release artifacts now use stable filenames
  (`DPlex-arm64.dmg`, `DPlex-Setup.exe`, `DPlex.AppImage`, etc.) so
  the `releases/latest/download/...` URLs in the README and landing
  page keep working across versions.
- macOS builds are now ad-hoc codesigned in CI when no Developer ID
  certificate is configured, avoiding the "DPlex is damaged" error
  on Gatekeeper while we wait for a paid signing cert.
- Every release artifact carries a Sigstore-signed build provenance
  attestation generated by GitHub Actions — verifiable with
  `gh attestation verify`.
- Auto-generated release notes are now grouped into Features / Bug
  Fixes / Performance / Documentation / Improvements / New providers
  / Testing & CI sections via `.github/release.yml`.
- Documentation, landing page, and demo assets refreshed for the
  open-source launch (PRIVACY.md, screenshots, animated demo GIF,
  GitHub Pages site).

## [0.9.0] — 2026-05-06

### Features

- **Activity bar** on the far left, VSCode-style. Switch between
  Projects, Sessions, and Source Control with a single click — clicking
  the active icon collapses the side panel for maximum editor space.
- **Source Control moved to the side panel.** Git changes for the
  selected project now live in the left panel alongside Projects and
  Sessions, replacing the old right-side Git panel and freeing the
  full editor width. A header dropdown lets you switch between any
  project or worktree without leaving the Git view.
- **Settings gear** at the bottom of the activity bar, in addition to
  the status-bar gear, for quick access to preferences.

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

[Unreleased]: https://github.com/Ron537/DPlex/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/Ron537/DPlex/compare/v0.17.2...v0.18.0
[0.17.2]: https://github.com/Ron537/DPlex/compare/v0.17.1...v0.17.2
[0.17.1]: https://github.com/Ron537/DPlex/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/Ron537/DPlex/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/Ron537/DPlex/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/Ron537/DPlex/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/Ron537/DPlex/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/Ron537/DPlex/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/Ron537/DPlex/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/Ron537/DPlex/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/Ron537/DPlex/compare/v0.11.3...v0.12.0
[0.11.3]: https://github.com/Ron537/DPlex/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/Ron537/DPlex/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/Ron537/DPlex/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/Ron537/DPlex/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Ron537/DPlex/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/Ron537/DPlex/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Ron537/DPlex/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Ron537/DPlex/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Ron537/DPlex/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Ron537/DPlex/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Ron537/DPlex/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Ron537/DPlex/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Ron537/DPlex/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ron537/DPlex/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/Ron537/DPlex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Ron537/DPlex/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ron537/DPlex/releases/tag/v0.1.0
