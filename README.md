<div align="center">

# DPlex

**A terminal multiplexer built for AI-assisted development**

DPlex is a desktop terminal app that manages multiple AI CLI tool sessions alongside regular terminals — all in one window. Think of it as a purpose-built workspace for developers who use tools like GitHub Copilot CLI, Claude Code, or Codex CLI daily across multiple projects.

Built with Electron · React · TypeScript

[Getting Started](#getting-started) · [Features](#features) · [Architecture](#architecture) · [Adding Providers](#adding-a-new-ai-provider)

</div>

---

## Why DPlex?

When working with AI CLI tools across multiple projects, you end up with a mess of terminal windows — one Copilot session here, a Claude session there, plus regular shells scattered everywhere. DPlex solves this by giving you:

- **One window** with split panes, tabs, and a project sidebar
- **Automatic session discovery** — sees your active and past AI sessions without manual tracking
- **Session persistence** — close the app, reopen it, and your AI sessions are restored exactly where you left off
- **Project-aware management** — group sessions by project, start new AI sessions with one click

## Getting Started

### Prerequisites

- Node.js 18+
- One or more AI CLI tools installed (`copilot`, `claude`, etc.)

### Install & Run

```bash
npm install
npm run dev
```

### Build for Distribution

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

## Features

### Terminal Multiplexer
- **Split panes** — horizontal and vertical splits with resizable dividers
- **Tabbed interface** — multiple terminals per pane, drag tabs between panes
- **Tab reordering** — drag and drop tabs within and across groups
- **Shell selector** — pick from auto-detected system shells (bash, zsh, fish, PowerShell, etc.) when opening a new terminal
- **Workspace persistence** — AI session tabs are saved and restored across app restarts

### Attention Inbox
- **Notification bell** — aggregated inbox surfaces sessions that need you, with an unread badge in the title bar
- **Event kinds** — separate signals for *waiting for approval*, *waiting for input*, and *finished*
- **Auto-dismiss on focus** — events clear automatically when you focus the relevant tab
- **Configurable cooldown** — tune how often a session can re-notify to avoid noise (in settings)
- **Jump-to-session** — click any inbox entry to activate its tab

### Project Management
- **Project sidebar** — add project folders, see active sessions at a glance
- **One-click AI sessions** — start a new AI session in any project directory
- **Active session indicators** — see which projects have running AI sessions (both DPlex-managed and external)
- **Quick actions** — open terminal, copy path, remove project from the context menu
- **Drag-and-drop reordering** — organize projects in your preferred order
- **Git branch display** — current branch shown per project

### Session History
- **Session discovery** — automatically discovers past sessions from AI tool data directories
- **Search & filter** — find sessions by name, ID, or summary
- **Resume sessions** — click to resume any past session in a new terminal tab
- **Close active sessions** — stop running AI sessions from the sidebar; closing a tab fully terminates the underlying AI process
- **Delete sessions** — remove session data from disk
- **Time and workspace grouping** — group session history by recency or by workspace
- **Prompt history viewer** — browse and search the list of prompts you've sent in any past session

### Multi-Provider Support
- **Provider-agnostic architecture** — pluggable provider system for any AI CLI tool
- **Built-in providers** — Copilot CLI supported out of the box
- **Configurable default** — choose your preferred AI tool in settings
- **Auto-detection** — sessions know which provider they belong to for correct resume commands

### Theming
8 built-in themes with matched terminal and UI colors:
- **Dark** — Midnight, Dracula, Monokai, Nord, Solarized Dark, GitHub Dark
- **Light** — GitHub Light, Solarized Light

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘T` | New terminal |
| `⌘W` | Close terminal |
| `⌘B` | Toggle sidebar |
| `⌘,` | Open settings |
| `⌘\` | Split horizontal |
| `⌘⇧\` | Split vertical |
| `⌘1-9` | Switch to tab N |

## Architecture

```
src/
├── main/                    # Electron main process (Node.js)
│   ├── index.ts             # App lifecycle, IPC handlers
│   └── services/
│       ├── ptyManager.ts    # PTY creation and management (node-pty)
│       ├── sessionPersistence.ts  # Workspace save/restore
│       └── providers/       # AI tool provider system
│           ├── types.ts     # SessionProvider interface
│           ├── copilotProvider.ts
│           ├── registry.ts  # ProviderRegistry
│           └── index.ts
├── preload/                 # IPC bridge (window.dplex API)
│   └── index.ts
└── renderer/                # React UI
    └── src/
        ├── stores/          # Zustand state (terminal, project, session, settings)
        ├── components/      # React components (layout, terminal, projects, sessions)
        ├── hooks/           # useTerminal, useSessions
        └── services/        # Terminal registry, theme definitions
```

### Key Design Decisions

- **Terminals survive tab switches** — xterm.js instances are kept in a global registry and DOM-attached/detached, never destroyed until explicitly closed
- **Session resolution by PID** — when an AI session starts, DPlex watches for lock files matching the PTY's PID to associate the session ID
- **Provider pattern** — each AI tool implements a `SessionProvider` interface; the registry aggregates across all providers

## Adding a New AI Provider

1. Create `src/main/services/providers/yourProvider.ts` implementing the `SessionProvider` interface
2. Register it in `createDefaultRegistry()` in `providers/index.ts`

The interface requires implementing:
- `discoverSessions()` — find sessions from the tool's data directory
- `getActiveProjectSessions(paths)` — find active sessions for given project paths
- `closeSession(id)` / `deleteSession(id)` — lifecycle management
- `resolveSessionByPid(pid)` / `resolveSessionByCwd(cwd)` — session identification
- `getResumeCommand(sessionId)` — the CLI command to resume (e.g. `copilot --resume=abc`)
- `getNewSessionCommand()` — the CLI command to start fresh (e.g. `copilot`)

No other files need changes — the registry, IPC, and UI all discover providers automatically.

## Tech Stack

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
| Packaging | electron-builder |

## License

Private project.
