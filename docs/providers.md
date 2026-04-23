# Adding an AI provider

DPlex is built around a pluggable provider abstraction so any AI CLI
tool can be wired in without touching the renderer, IPC layer, or
state stores. This guide walks through adding a new provider end to
end. The reference implementation is
[`copilotProvider.ts`](../src/main/services/providers/copilotProvider.ts).

## What you'll write

A single file in `src/main/services/providers/` that exports a class
implementing the `SessionProvider` interface, plus one line in
`createDefaultRegistry()` to register it.

That's it. The `ProviderRegistry` aggregates operations across all
providers; IPC handlers in `src/main/index.ts` already delegate to
the registry; the renderer is provider-agnostic and discovers the
list of providers through `window.dplex.sessions.getProviders()`.

## The interface

From [`types.ts`](../src/main/services/providers/types.ts):

```ts
interface SessionProvider {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly icon?: string

  discoverSessions(): Promise<DiscoveredSession[]>
  closeSession(sessionId: string): Promise<boolean>
  deleteSession(sessionId: string): Promise<void>
  resolveSessionByPid(pid: number): Promise<ResolvedSession | null>
  resolveSessionByCwd(cwd: string): Promise<ResolvedSession | null>
  getResumeCommand(sessionId: string): string
  getNewSessionCommand(): string
  startWatching(callbacks: WatcherCallbacks): Promise<void>
  stopWatching(): void
  getPrompts(sessionId: string, limit?: number): Promise<SessionPrompt[]>
}
```

| Method                   | Purpose                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `id`                     | Stable identifier, e.g. `copilot`, `claude`. Used in stored session metadata, do **not** change later.   |
| `name`                   | Human-readable name shown in UI, e.g. "Copilot CLI".                                                     |
| `command`                | The CLI binary on the user's PATH, e.g. `copilot`.                                                       |
| `icon`                   | Optional path to a PNG/SVG bundled in `resources/`.                                                       |
| `discoverSessions()`     | Scan the tool's data directory and return every session DPlex should know about.                         |
| `closeSession(id)`       | Kill the running OS process backing a session. Return `true` if a process was actually killed.           |
| `deleteSession(id)`      | Remove the session's data files from disk. Should be idempotent.                                         |
| `resolveSessionByPid`    | Given a PID (the PTY's PID), return the session ID the AI tool created. Used for in-DPlex sessions.     |
| `resolveSessionByCwd`    | Fallback when PID lookup fails: most-recent session whose CWD matches.                                  |
| `getResumeCommand(id)`   | The exact CLI invocation to resume a session, e.g. `copilot --resume=abc`.                              |
| `getNewSessionCommand()` | The CLI invocation to start a fresh session, e.g. `copilot`.                                            |
| `startWatching`          | Begin emitting real-time `onAdded` / `onUpdated` / `onRemoved` callbacks as sessions change on disk.    |
| `stopWatching()`         | Tear down watchers. Must be safe to call repeatedly and after `startWatching` was never called.         |
| `getPrompts(id, limit)`  | Return the user prompts sent in a session, in chronological order. Powers the "Prompts" dialog.         |

If the AI tool you're integrating doesn't store something natively
(prompt history, for example), it's fine to return `[]` — the UI
gracefully degrades.

## Step-by-step

### 1. Investigate the tool

Before writing code, find answers to these questions about the tool
you're integrating:

1. **Binary name and PATH expectations** — what does the user type to
   invoke it? Does it require a login step DPlex can't perform?
2. **Session storage** — where does the tool write session/chat data?
   What's the file format (JSONL, JSON, SQLite, …)?
3. **Active-session detection** — lock files? PID files? An open
   socket? Process inspection?
4. **Resume command** — how is a past session re-opened from the CLI?
   Is the session ID embedded in a flag, an env var, or positional?
5. **Prompts** — are user prompts recoverable from the on-disk format?

### 2. Create the provider class

Copy `copilotProvider.ts` as a starting point if your tool has a
similar shape (one file per session in a known directory). For tools
that need richer state, you can extend `BaseSessionProvider` from
[`baseProvider.ts`](../src/main/services/providers/baseProvider.ts) —
it provides shared helpers for process killing and PID lookup.

Place your file in `src/main/services/providers/yourTool.ts`.

```ts
import type { SessionProvider, /* … */ } from './types'

export class YourToolProvider implements SessionProvider {
  readonly id = 'yourtool'
  readonly name = 'Your Tool'
  readonly command = 'yourtool'

  async discoverSessions() { /* … */ }
  // …
}
```

### 3. Register the provider

In [`index.ts`](../src/main/services/providers/index.ts), add your
provider to `createDefaultRegistry()`:

```ts
import { YourToolProvider } from './yourTool'

export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  registry.register(new CopilotProvider())
  registry.register(new YourToolProvider())
  return registry
}
```

That's the only file outside your provider that needs to change.

### 4. Verify in dev

```bash
npm run dev
```

You should see your provider:

- Listed in the "Start AI session" picker on a project row.
- Surfaced in the Sessions list once you have at least one session.
- Resumable from the sidebar (the resume command should match what
  the user would type by hand).

If a session you start in DPlex doesn't get linked to a session ID,
your `resolveSessionByPid` is the most likely culprit — many tools
write their lock/PID file with a small delay, so DPlex retries for a
short window. Make sure your implementation handles "not yet there"
by returning `null` rather than throwing.

### 5. Add tests

Place unit tests under `tests/unit/your-tool-provider.test.ts`. The
existing Copilot tests are a useful template — they fixture the data
directory and assert that `discoverSessions`, `getPrompts`, and
`getResumeCommand` produce the expected output.

For e2e coverage, you generally don't need to add a Playwright test
unless your provider exposes new UI surface — the existing suites
exercise the provider-agnostic flows.

### 6. Open a PR

Use the [Provider request issue template](../.github/ISSUE_TEMPLATE/provider_request.yml)
or open a PR directly. Please include in the PR description:

- The exact CLI version of the tool you tested against.
- Sample session paths/formats (redacted) so future maintainers can
  understand the on-disk layout.
- Screenshots of the provider working in DPlex.

## Common pitfalls

- **Hardcoded paths.** Resolve the data directory through `os.homedir()`
  + `path.join`. Tools store data in different places on macOS, Linux,
  and Windows — handle all three.
- **Blocking I/O in `startWatching`.** The watcher runs in the main
  process; long-running synchronous file walks will freeze IPC. Use
  async APIs and `chokidar` (already a transitive dependency) for
  filesystem watching.
- **Forgetting to call cleanup in `stopWatching`.** Watchers leak file
  descriptors otherwise. The `closed` window handler explicitly calls
  `stopWatching` for every registered provider, so getting it wrong
  produces hard-to-find leaks rather than visible breakage.
- **Throwing on missing data directories.** A user who doesn't have
  the AI tool installed should still see DPlex working — your provider
  should return `[]` from `discoverSessions` rather than throw.

If you hit something not covered here, please open a discussion or
issue — improvements to this doc are welcome.
