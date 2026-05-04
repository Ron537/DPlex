import { memo, useCallback, useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getAvatarColor, getAvatarInitials } from '../../utils/projectStatus'
import { focusFirstTabForPaths } from '../../utils/sessionTabs'
import { STATUS_ACTIVE_COLOR } from '../../utils/statusColors'
import { aggregateVisual } from '../../utils/aggregateVisual'
import type { Project } from '../../types'
import type { ProjectActivity } from '../../hooks/useProjectSessions'
import type { AttentionEvent } from '../../../../preload/attentionTypes'

const BUTTON_SIZE = 36
// Match the FLIP transition duration in `useProjectAvatarFlip` so status
// rings and notification badges only appear once the avatar has finished
// gliding into its rail position. Add a small buffer for the rAF + paint.
const STATUS_REVEAL_DELAY_MS = 280

interface ProjectAvatarButtonProps {
  project: Project
  activity: ProjectActivity
  attentionEvents: AttentionEvent[]
}

/**
 * Compact avatar-only button for a project. Used by `ProjectList` when the
 * sidebar is collapsed: each project row shrinks to just its avatar so the
 * collapsed sidebar acts as a vertical project rail. Clicking restores the
 * panel to its expanded width and emphasizes the project.
 *
 * Memoized so an unrelated project changing status doesn't reflow the whole
 * compact list — only the affected button rerenders.
 */
export const ProjectAvatarButton = memo(function ProjectAvatarButton({
  project,
  activity,
  attentionEvents
}: ProjectAvatarButtonProps): React.JSX.Element {
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setLastExpanded = useProjectStore((s) => s.setLastExpanded)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const isActive = useProjectStore((s) => s.activeProjectId === project.id)

  // Hold off on the colored status ring / attention badge until the FLIP
  // animation that glides this avatar into the rail has finished. Without
  // this, the green/amber ring snaps in around the still-animating avatar
  // and looks jittery. After the delay, status changes apply immediately.
  const [statusRevealed, setStatusRevealed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setStatusRevealed(true), STATUS_REVEAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  // Project state taxonomy:
  //   • "live"     — has at least one *active* AI session (lock alive) or
  //     an open terminal tab. Historical, idle sessions don't count — they
  //     would otherwise mark every project that's ever been used as live.
  //   • "running"  — at least one of those sessions has an actively-working
  //     agent (`detailedStatus` is `thinking` or `executingTool`). A session
  //     can be `status: 'active'` (lock alive) yet sit idle waiting for the
  //     user — those don't count here.
  //   • "attention"— there is an unsuppressed attention event (waiting for
  //     approval, waiting for input, finished). Visually outranks "running".
  // Visual mapping:
  //   • Not live   → avatar dimmed (subtle disabled look), neutral border.
  //   • Live       → avatar at full opacity, neutral border.
  //   • Running    → avatar at full opacity, green border + pulse.
  //   • Attention  → amber border + corner badge (overrides green).
  const isLive = activity.hasActive || activity.openTabs.length > 0
  // Only consider currently-active sessions (lock alive). An idle session
  // can still carry a stale `detailedStatus` from the last time the agent
  // ran, which would otherwise light up the green ring forever.
  const isRunning = activity.sessions.some(
    (s) =>
      s.status === 'active' &&
      (s.detailedStatus === 'thinking' || s.detailedStatus === 'executingTool')
  )
  const color = getAvatarColor(project.id)
  const initials = getAvatarInitials(project.name)
  const attentionCount = attentionEvents.length

  const tooltip = (() => {
    const parts: string[] = [project.name]
    if (attentionCount > 0) {
      parts.push(`${attentionCount} need${attentionCount === 1 ? 's' : ''} input`)
    } else if (isRunning) {
      parts.push('running')
    } else if (isLive) {
      parts.push('idle')
    }
    return parts.join(' · ')
  })()

  const handleClick = useCallback((): void => {
    const expanded = useProjectStore.getState().expandedProjectIds
    setActiveProject(project.id)
    // Follow the panel selection: jump to the first tab in this project
    // tree (own path + any worktree-child path).
    const allProjects = useProjectStore.getState().projects
    const paths = new Set<string>([project.path])
    for (const p of allProjects) {
      if (p.parentProjectId === project.id) paths.add(p.path)
    }
    focusFirstTabForPaths(paths)
    if (!expanded.has(project.id)) {
      toggleExpanded(project.id)
    } else {
      setLastExpanded(project.id)
    }
    // The rail is only rendered while the panel is collapsed, but we always
    // expand back into the Projects view so the user lands on the row they
    // just clicked — even if Sessions was the last-active tab.
    if (useSettingsStore.getState().settings.sidebarPanelCollapsed) {
      updateSettings({ sidebarPanelCollapsed: false, sidebarActiveTab: 'projects' })
    } else if (useSettingsStore.getState().settings.sidebarActiveTab !== 'projects') {
      updateSettings({ sidebarActiveTab: 'projects' })
    }
  }, [project.id, setActiveProject, setLastExpanded, toggleExpanded, updateSettings])

  return (
    <button
      type="button"
      onClick={handleClick}
      role="listitem"
      aria-label={tooltip}
      title={tooltip}
      className="relative flex items-center justify-center transition-transform hover:-translate-y-px"
      data-project-id={project.id}
      style={{
        width: BUTTON_SIZE,
        height: BUTTON_SIZE
      }}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute"
          style={{
            left: -8,
            top: 6,
            bottom: 6,
            width: 2,
            borderRadius: 2,
            backgroundColor: 'var(--dplex-accent)'
          }}
        />
      )}
      <span
        aria-hidden
        data-project-avatar={project.id}
        className="flex items-center justify-center font-bold leading-none select-none"
        style={{
          width: BUTTON_SIZE - 4,
          height: BUTTON_SIZE - 4,
          fontSize: 12,
          borderRadius: 10,
          backgroundColor: color.bg,
          color: color.fg,
          // Status ring: amber only when something needs input. Running
          // state is signalled by the bottom-right status dot (which now
          // covers all five status visuals) so the border stays quiet
          // unless attention is required.
          border: `1.5px solid ${
            statusRevealed && attentionCount > 0
              ? 'var(--dplex-status-approval)'
              : 'var(--dplex-border)'
          }`,
          transition: 'border-color 280ms ease, opacity 280ms ease',
          // Dim avatars for projects that are not "live" so the rail clearly
          // surfaces in-use projects. The transition is shared with the
          // border so reveal feels coordinated.
          opacity: !statusRevealed ? 0.85 : isLive || isActive ? 1 : 0.5
        }}
      >
        {initials}
      </span>
      {(() => {
        // Bottom-right liveness dot — mirrors the dot on the expanded
        // ProjectItem avatar so the collapsed rail carries the same
        // signal at a glance. Hidden when the (top-right) attention
        // badge is showing — the amber count already implies activity
        // and we don't want two dots fighting for the same avatar.
        const liveCount = activity.activeCount > 0 ? activity.activeCount : activity.openTabs.length
        if (liveCount === 0 || attentionCount > 0) return null
        const live = activity.activeCount > 0
        // Mirror the expanded ProjectItem dot: aggregate the highest-priority
        // visual across active sessions so the rail conveys "running" /
        // "waiting for input" instead of always reading as plain green.
        const visual = live ? aggregateVisual(activity.sessions) : 'idle'
        const dotColor = !live
          ? 'var(--dplex-accent)'
          : visual === 'attn'
            ? 'var(--dplex-status-approval)'
            : visual === 'waiting'
              ? 'var(--dplex-status-waiting)'
              : visual === 'running'
                ? 'var(--dplex-status-executing)'
                : visual === 'thinking'
                  ? 'var(--dplex-status-thinking)'
                  : STATUS_ACTIVE_COLOR
        return (
          <span
            aria-hidden
            className="absolute rounded-full pointer-events-none"
            style={{
              bottom: 0,
              right: 0,
              width: 10,
              height: 10,
              backgroundColor: dotColor,
              border: '1.5px solid var(--dplex-bg-alt)',
              opacity: statusRevealed ? 1 : 0,
              transition: 'opacity 200ms ease'
            }}
          />
        )
      })()}
      {attentionCount > 0 && (
        <span
          aria-hidden
          className="absolute flex items-center justify-center text-[9px] font-bold tabular-nums"
          style={{
            top: -2,
            right: -2,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            backgroundColor: 'var(--dplex-status-approval)',
            color: '#fff',
            border: '2px solid var(--dplex-bg-alt)',
            opacity: statusRevealed ? 1 : 0,
            transform: statusRevealed ? 'scale(1)' : 'scale(0.6)',
            transition: 'opacity 200ms ease, transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1.4)',
            pointerEvents: 'none'
          }}
        >
          {attentionCount > 9 ? '9+' : attentionCount}
        </span>
      )}
    </button>
  )
})
