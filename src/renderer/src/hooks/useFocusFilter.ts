import { useCallback } from 'react'
import { useTabFocusStore } from '../stores/tabFocusStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { tabMatchesFocus } from '../utils/tabFocus'
import type { EditorTab } from '../types'

export interface FocusFilter {
  /** The project currently focused, or `null` when focus is off. */
  focusedProjectId: string | null
  /** Configured focus style. */
  mode: 'dim' | 'isolate'
  /** True when focus is on AND the isolate style is active (tabs are hidden). */
  isolate: boolean
  /** True when focus is on AND the dim style is active (tabs are de-emphasized). */
  dim: boolean
  /** Whether a tab belongs to the focused project (always true when focus is off). */
  matches: (tab: EditorTab) => boolean
}

/**
 * Shared reactive view of the project focus filter for rendering components.
 * Reads the focus target, the dim/isolate setting and the project list, and
 * exposes a stable `matches` predicate built on {@link tabMatchesFocus}.
 */
export function useFocusFilter(): FocusFilter {
  const focusedProjectId = useTabFocusStore((s) => s.focusedProjectId)
  const projects = useProjectStore((s) => s.projects)
  const mode = useSettingsStore((s) => s.settings.focusFilterMode)
  const active = focusedProjectId !== null
  const matches = useCallback(
    (tab: EditorTab) => tabMatchesFocus(tab, projects, focusedProjectId),
    [projects, focusedProjectId]
  )
  return {
    focusedProjectId,
    mode,
    isolate: active && mode === 'isolate',
    dim: active && mode === 'dim',
    matches
  }
}
