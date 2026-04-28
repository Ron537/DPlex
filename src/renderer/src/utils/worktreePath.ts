/**
 * Helpers for worktree path/branch handling in the UI.
 */

/**
 * Slugify a branch name for filesystem use:
 *   feature/auth     → feature-auth
 *   release/1.2      → release-1.2
 *   fix my-thing     → fix-my-thing
 *   héllo/wörld      → hllo-wrld (ascii only)
 */
export function slugifyBranch(branch: string): string {
  return branch
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * Expand a location pattern with {project} and {branch} placeholders.
 * Branch is slugified on the way through.
 */
export function expandPattern(pattern: string, projectName: string, branch: string): string {
  return pattern.replace(/\{project\}/g, projectName).replace(/\{branch\}/g, slugifyBranch(branch))
}
