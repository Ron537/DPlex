# Security Policy

Thanks for taking the time to help keep DPlex users safe.

## Supported Versions

DPlex is pre-1.0 software. Security fixes are applied to the **latest
released version** only. We recommend always running the most recent
release available from the GitHub Releases page.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| Older   | :x:                |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security problems.**

Instead, report vulnerabilities privately using one of the following:

1. **GitHub Security Advisories (preferred)** — open a private advisory
   at <https://github.com/Ron537/DPlex/security/advisories/new>.
2. **Email** — <roni537@gmail.com> with the subject line
   `[DPlex security] <short description>`.

Please include:

- A clear description of the issue and its impact.
- Steps to reproduce, or a proof-of-concept.
- The DPlex version and operating system you tested on.
- Any suggested mitigation you have in mind.

### What to expect

- **Acknowledgement:** within 72 hours.
- **Initial assessment:** within 7 days.
- **Fix timeline:** depends on severity and complexity; we will keep you
  updated.
- **Disclosure:** we practice coordinated disclosure. Once a fix is
  available, we will credit reporters who wish to be named.

## Scope

DPlex is an Electron desktop application that spawns local PTY
processes and orchestrates AI CLI tools. Vulnerabilities of particular
interest include:

- Renderer → main process privilege escalation via IPC.
- Shell or command injection via project paths, branch names, worktree
  names, or session metadata.
- Path traversal in session discovery, worktree creation, or workspace
  persistence.
- Sandbox / `contextIsolation` bypasses.
- Arbitrary file read/write outside the Electron userData directory or
  the user's explicitly selected project paths.
- Unsafe handling of third-party content rendered by xterm.js or any
  HTML surface.

Issues in upstream dependencies (Electron, node-pty, xterm.js, etc.)
should generally be reported to those projects first. If you believe
DPlex's usage makes an upstream issue materially worse, we still want
to hear about it.

## Out of Scope

- Issues that require pre-existing local access to the user's machine
  or the ability to run arbitrary code as the user.
- Social engineering of maintainers or users.
- Denial of service from clearly malformed local files the user
  authored themselves.

Thank you for helping keep DPlex and its users safe.
