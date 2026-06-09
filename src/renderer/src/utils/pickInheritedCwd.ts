/**
 * Pick the working directory a newly opened terminal should inherit from the
 * focused one, in priority order:
 *   1. Live cwd of the focused PTY's process — tracks `cd` (macOS/Linux only;
 *      null on Windows where process cwd can't be introspected cheaply).
 *   2. The focused tab's own path — its worktree path or starting cwd.
 *   3. The root of the project the focused tab belongs to — cross-platform,
 *      so Windows users still land in the right project.
 *
 * Returns undefined when none apply, letting the caller fall back to $HOME.
 */
export function pickInheritedCwd(sources: {
  liveCwd: string | null
  tabOwnPath: string | undefined
  projectPath: string | undefined
}): string | undefined {
  return sources.liveCwd || sources.tabOwnPath || sources.projectPath || undefined
}
