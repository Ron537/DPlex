# Privacy

DPlex is a desktop terminal application. **It collects no telemetry, sends
no analytics, and makes no network requests of its own.**

This document explains exactly what data DPlex touches on your machine, why,
and what stays local.

## What stays on your machine

Everything DPlex reads or writes lives on your computer.

| Data                    | Where it lives                                                                                            | Why DPlex needs it                                                                                                                |
|-------------------------|-----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| App settings            | OS user-data directory (e.g. `~/Library/Application Support/DPlex` on macOS)                              | Theme, keyboard shortcuts, window size, project list, panel layout.                                                               |
| Project list            | Same `settings.json` as above                                                                             | The folders you've added to the project sidebar so they reappear after restart.                                                   |
| Workspace state         | Same user-data directory (`sessions.json`)                                                                | Restores your tabs, splits, and active AI sessions on the next launch.                                                            |
| AI session metadata     | Provider data dirs you already use — e.g. `~/.copilot/session-state`, `~/.claude/projects`, etc.          | Read-only discovery so DPlex can list and resume sessions you started elsewhere. **DPlex does not create, modify, or delete these files unless you explicitly delete a session from the Sessions panel.** |
| Git status              | Project repos you added                                                                                   | Powers the Source Control view. Reads via `libgit2`-equivalent calls + `git` subprocess; never pushes, fetches, or commits.       |
| Terminal output         | Live PTY buffer in memory only                                                                            | Rendered by `xterm.js`. Not persisted, not transmitted.                                                                           |

## What DPlex does NOT do

- **No telemetry.** No usage events, crash reports, feature flags, or A/B testing pings.
- **No analytics SDK.** None embedded — verify with `grep -r "analytics\|telemetry\|posthog\|sentry" src/`.
- **No remote logging.** Errors are printed to the local Electron developer tools console only.
- **No background network requests** initiated by DPlex itself.

## Network activity you may see anyway

DPlex itself doesn't talk to the network, but the **AI CLI tools it manages
do.** When you start a Copilot CLI or Claude Code session, that process talks
to its own backend (GitHub / Anthropic / etc.) on its own — DPlex just hosts
the terminal. Their privacy policies apply, not DPlex's.

DPlex's auto-update mechanism (`electron-updater`) checks GitHub Releases for
new versions when the app starts. This sends:
- A `User-Agent` string identifying your DPlex version + Electron version + OS.
- Your IP address (visible to GitHub, as with any HTTPS request to github.com).

You can disable update checks by toggling **Settings → Updates → Check for
updates automatically** off. (If that toggle isn't available in your version,
update checks happen on launch only and never proactively download anything
without your confirmation.)

## Code review

DPlex is open-source under the MIT License. The end-to-end source for the
behavior described above lives in:

- `src/main/services/providers/` — read-only session discovery
- `src/main/index.ts` — IPC surface (no telemetry registered)
- `src/renderer/src/stores/` — state management (no analytics imports)

If you find a discrepancy between this document and the code's actual
behavior, please open a security advisory per [SECURITY.md](./SECURITY.md) —
a privacy regression is treated as a security issue.

## Reporting a privacy concern

Please open a private security advisory at
<https://github.com/Ron537/DPlex/security/advisories/new> rather than a
public issue.

---

_Last updated alongside DPlex 0.9.0._
