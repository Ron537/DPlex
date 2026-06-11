import { Focus, X } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabFocusStore, enableFocus, disableFocus } from '../../stores/tabFocusStore'
import { MOD, SHIFT } from '../../utils/shortcuts'

/**
 * Prominent project-focus control in the title bar.
 *
 * - OFF: a single "Focus" button that focuses the active project's tabs.
 * - ON:  a connected pill showing the focused project, an inline Dim/Isolate
 *        style switch, and a clear (×) action.
 *
 * The style switch is shown ONLY while focus is on, where flipping it has an
 * immediate visible effect (re-dimming vs. re-hiding tabs) — when focus is off
 * the persistent default lives in Settings instead, so the title bar never
 * shows a control that does nothing.
 */
export function ProjectFocusControl(): React.JSX.Element | null {
  const focusedProjectId = useTabFocusStore((s) => s.focusedProjectId)
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const mode = useSettingsStore((s) => s.settings.focusFilterMode)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const on = focusedProjectId !== null
  const focusedProject = focusedProjectId
    ? projects.find((p) => p.id === focusedProjectId)
    : undefined
  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : undefined
  // Focus targets the family (parent) project, so a worktree selection focuses
  // its whole repo. Display that target's name for an accurate tooltip.
  const targetProject = activeProject?.parentProjectId
    ? (projects.find((p) => p.id === activeProject.parentProjectId) ?? activeProject)
    : activeProject
  const canEnable = activeProject !== undefined

  if (!on) {
    return (
      <button
        onClick={() => enableFocus()}
        disabled={!canEnable}
        className="inline-flex items-center gap-1.5 px-2 rounded-full transition-colors flex-shrink-0 no-drag hover:bg-[var(--dplex-hover)] disabled:opacity-40"
        style={{ height: 22, fontSize: 11, color: 'var(--dplex-text-muted)' }}
        title={
          canEnable
            ? `Focus "${targetProject?.name}" (${MOD}${SHIFT}O)`
            : 'Select a project to focus its tabs'
        }
        aria-label="Focus active project"
      >
        <Focus size={11} />
        <span>Focus</span>
      </button>
    )
  }

  const setMode = (next: 'dim' | 'isolate'): void => {
    if (next !== mode) void updateSettings({ focusFilterMode: next })
  }

  const segment = (value: 'dim' | 'isolate', label: string, hint: string): React.JSX.Element => {
    const active = mode === value
    return (
      <button
        onClick={() => setMode(value)}
        className="rounded-full transition-colors"
        style={{
          height: 16,
          padding: '0 8px',
          fontSize: 9.5,
          fontWeight: active ? 700 : 500,
          letterSpacing: '0.02em',
          // Active segment uses the solid accent fill + on-accent text so it
          // stays high-contrast against the soft-accent pill on every theme,
          // rather than relying on subtle elevation differences.
          color: active ? 'var(--dplex-accent-fg)' : 'var(--dplex-text-muted)',
          backgroundColor: active ? 'var(--dplex-accent)' : 'transparent'
        }}
        title={hint}
        aria-pressed={active}
      >
        {label}
      </button>
    )
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full flex-shrink-0 no-drag"
      style={{
        height: 22,
        padding: '0 4px 0 8px',
        border: '1px solid var(--dplex-accent-ring)',
        backgroundColor: 'var(--dplex-accent-soft)',
        color: 'var(--dplex-text)',
        fontSize: 11
      }}
    >
      <Focus size={11} className="flex-shrink-0" style={{ color: 'var(--dplex-accent)' }} />
      <span className="truncate" style={{ maxWidth: 130 }} title={focusedProject?.name}>
        {focusedProject?.name ?? 'Focused'}
      </span>
      {/* Inline style switch — only meaningful while focus is on, so it lives
          here (not when focus is off) and changes the view immediately. */}
      <span
        className="inline-flex items-center rounded-full"
        style={{
          backgroundColor: 'var(--dplex-bg)',
          border: '1px solid var(--dplex-border)',
          padding: 1
        }}
      >
        {segment('dim', 'Dim', 'Dim other projects\u2019 tabs')}
        {segment('isolate', 'Isolate', 'Show only this project\u2019s tabs')}
      </span>
      <button
        onClick={() => disableFocus()}
        className="rounded-full p-0.5 transition-colors hover:bg-[var(--dplex-hover)]"
        style={{ color: 'var(--dplex-text-muted)' }}
        title={`Show all tabs (${MOD}${SHIFT}O)`}
        aria-label="Clear focus"
      >
        <X size={12} />
      </button>
    </div>
  )
}
