import { create } from 'zustand'

/**
 * Ephemeral per-session UI state for the "focus a project" tab filter.
 *
 * When `focusedProjectId` is non-null, tabs whose project (or worktree's
 * parent project) doesn't match get visually de-emphasized in their tab
 * bars — the underlying tab order, group membership, and PTYs are
 * untouched. Toggling focus off restores the unfiltered view exactly as
 * the user left it.
 *
 * Not persisted: the filter is intentionally a session-scoped lens, not
 * part of the workspace, so reopening DPlex never starts you inside a
 * filtered view you forgot was on.
 */
interface TabFocusState {
  focusedProjectId: string | null
  /** Set focus to a specific project. Use `null` to clear. */
  setFocusedProject: (projectId: string | null) => void
  /** Toggle focus on `projectId`: enables it, or clears if already focused on the same project. */
  toggleFocusedProject: (projectId: string) => void
  clear: () => void
}

export const useTabFocusStore = create<TabFocusState>((set, get) => ({
  focusedProjectId: null,
  setFocusedProject: (projectId) => set({ focusedProjectId: projectId }),
  toggleFocusedProject: (projectId) => {
    const current = get().focusedProjectId
    set({ focusedProjectId: current === projectId ? null : projectId })
  },
  clear: () => set({ focusedProjectId: null })
}))
