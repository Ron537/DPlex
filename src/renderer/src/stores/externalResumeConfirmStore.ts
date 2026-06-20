import { create } from 'zustand'
import type { AISession } from '../types'
import { resumeOrFocusSession, hasOpenTab } from '../utils/sessionTabs'

/** Minimal session shape needed to resume + describe the pending session. */
export type PendingExternalSession = Pick<AISession, 'id' | 'aiTool' | 'displayName' | 'cwd'>

/** Session shape the guard needs — adds `status` so it can detect externals. */
export type GuardableSession = PendingExternalSession & Pick<AISession, 'status'>

interface ExternalResumeConfirmState {
  /** Session awaiting a "resume outside DPlex" confirmation, or null. */
  pending: PendingExternalSession | null
  /** Ask to resume an external session; opens the confirmation prompt. */
  request: (session: PendingExternalSession) => void
  cancel: () => void
  /** Proceed with the resume the user confirmed. */
  confirm: () => void
}

/**
 * Single choke point for resuming a session that is running *outside* DPlex.
 * Such sessions are already active in another terminal, so resuming them here
 * opens a second connection to the same session — easy to trigger by an
 * accidental click. Routing those resumes through a confirmation prompt makes
 * the action deliberate. DPlex-owned sessions never go through here.
 */
export const useExternalResumeConfirmStore = create<ExternalResumeConfirmState>((set, get) => ({
  pending: null,
  request: (session) => set({ pending: session }),
  cancel: () => set({ pending: null }),
  confirm: () => {
    const session = get().pending
    set({ pending: null })
    if (session) void resumeOrFocusSession(session)
  }
}))

/**
 * Resume a session, prompting for confirmation first when it is running
 * outside DPlex. A session counts as "external" when it is active but no
 * DPlex tab backs it (closing the owning tab would have killed it, so an
 * active-yet-untabbed session must live in another terminal). Owned sessions
 * (a tab focuses) and idle sessions (resuming can't conflict) resume directly.
 *
 * This is the entry point every resume call-site should use so the guard is
 * applied uniformly — the Projects panel, the Sessions sidebar, the command
 * palette, etc. — rather than depending on per-surface flags.
 */
export function resumeSessionGuarded(session: GuardableSession): void {
  if (session.status === 'active' && !hasOpenTab(session.id, session.aiTool)) {
    useExternalResumeConfirmStore.getState().request(session)
    return
  }
  void resumeOrFocusSession(session)
}
