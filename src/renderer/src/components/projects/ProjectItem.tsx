import { useState, useRef, useEffect, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Play,
  GitBranch,
  MoreVertical,
  Terminal,
  Copy,
  Trash2,
  GitFork,
  Settings2,
  Pin,
  PinOff,
  ArrowUp,
  ArrowDown,
  GitCompare,
  Tag as TagIcon,
  X
} from 'lucide-react'
import type { Project, AISession, ProviderInfo, WorktreeDefaults } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useWorktrees } from '../../hooks/useWorktrees'
import { STATUS_ACTIVE_COLOR } from '../../utils/statusColors'
import { deriveAvatarColor, getAvatarInitials } from '../../utils/projectStatus'
import { isMixedProviderList } from '../../utils/providerHelpers'
import { aggregateVisual } from '../../utils/aggregateVisual'
import { PromptsDialog } from '../sessions/PromptsDialog'
import { ProjectSessionList, selectRecentSessions } from './ProjectSessionList'
import { TagDots } from './TagDots'
import { TagPickerPopover } from './TagPickerPopover'
import { WorktreeSection } from './WorktreeSection'
import type { ProjectActivity } from '../../hooks/useProjectSessions'
import { focusFirstTabForPaths } from '../../utils/sessionTabs'
import { colorSourceProject } from '../../utils/tabProject'
import { startProjectSession, openProjectTerminal } from '../../utils/spaceStart'
import { TAB_COLORS } from '../../utils/tabColors'
import { PopoverMenu } from '../common/PopoverMenu'
import { NewWorktreeModal } from '../worktrees/NewWorktreeModal'
import { ManageWorktreesModal } from '../worktrees/ManageWorktreesModal'
import { RemoveWorktreeProjectModal } from '../worktrees/RemoveWorktreeProjectModal'
import { ProjectWorktreeDefaultsModal } from '../worktrees/ProjectWorktreeDefaultsModal'
import { handleWorktreeCreated } from '../../services/worktreePostCreate'
import { useGitPanelStore } from '../../stores/gitPanelStore'

interface ProjectItemProps {
  project: Project
  activity: ProjectActivity
  providers: ProviderInfo[]
  /** Worktree-child projects to render inline within this project's expanded body. */
  childProjects?: Project[]
  /** Resolves activity for a child project path. */
  getActivity?: (path: string) => ProjectActivity
  /** Id of the previous top-level sibling in the same pinned group (for "Move up"). */
  moveUpTargetId?: string | null
  /** Id of the next top-level sibling in the same pinned group (for "Move down"). */
  moveDownTargetId?: string | null
  /** Render the expanded body regardless of the user's persisted expansion
   *  state. Used by `ProjectList` in filter mode so a matched parent shows
   *  its full worktree subtree even when the user had it collapsed. */
  forceExpanded?: boolean
}

/**
 * Compact relative-time label for the right edge of project rows (mirrors
 * the "3h / 2d / 15m" look from the redesign mockup). Suffix-free and
 * tabular-friendly so rows stack cleanly.
 */
function relativeTimeShort(date: Date | undefined): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function ProjectItem({
  project,
  activity,
  providers,
  childProjects,
  getActivity,
  moveUpTargetId = null,
  moveDownTargetId = null,
  forceExpanded = false
}: ProjectItemProps): React.JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const setLastExpanded = useProjectStore((s) => s.setLastExpanded)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const removeProject = useProjectStore((s) => s.removeProject)
  const togglePin = useProjectStore((s) => s.togglePin)
  const reorderProject = useProjectStore((s) => s.reorderProject)
  const setProjectTabColor = useProjectStore((s) => s.setProjectTabColor)
  const allProjectsForColor = useProjectStore((s) => s.projects)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const globalDefaults = useSettingsStore((s) => s.settings.worktreeDefaults)
  const defaultAITool = useSettingsStore((s) => s.settings.defaultAITool)
  const showRecentInProject = useSettingsStore((s) => s.settings.showRecentSessionsInProject)
  const recentSessionsCount = useSettingsStore((s) => s.settings.recentSessionsCount)
  const hideEmptySessions = useSettingsStore((s) => s.settings.hideEmptySessions)
  // Resolve the provider for the inline action button. Falls back to the
  // first registered provider so the button still works if the configured
  // default has been removed.
  const primaryProvider = providers.find((p) => p.id === defaultAITool) ?? providers[0]
  const [showMenu, setShowMenu] = useState(false)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const [newWtOpen, setNewWtOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [removeWtOpen, setRemoveWtOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const tagPickerAnchorRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)
  // Virtual anchor for right-click context menu — positioned at the cursor
  // so the menu opens where the user clicked (not next to the ⋯ button).
  const contextAnchorRef = useRef<HTMLDivElement>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  // Once the menu closes (via any item click or outside click), reset the
  // cursor anchor so a subsequent click on the ⋯ button re-anchors there.
  useEffect(() => {
    if (!showMenu) setContextMenuPos(null)
  }, [showMenu])

  const isWorktreeProject = Boolean(project.parentProjectId || project.parentRepoPath)
  // Only subscribe to worktree info when we actually need it (for the modal
  // or for disk-deletion) — avoids a watcher for every worktree-project.
  const needWtWatch = newWtOpen || manageOpen || removeWtOpen
  // Worktree-projects rendered top-level (filter mode) fall back to their
  // parentRepoPath for worktree operations; otherwise we use the project's
  // own path. The parent record is no longer passed down — worktrees nested
  // inside a project render as `WorktreeSection`, not as nested ProjectItems.
  const watchPath = isWorktreeProject ? (project.parentRepoPath ?? project.path) : project.path
  const { repoRoot } = useWorktrees(needWtWatch ? watchPath : undefined)

  const isExpanded = forceExpanded || expandedIds.has(project.id)
  // The project row reads as "active" when it's the directly-active project
  // OR when one of its worktree-child projects is active. The latter case
  // is the "ambient parent highlight" — selecting a worktree section under
  // this project still ought to surface which top-level project it belongs
  // to. Only fires when worktrees render *nested* inside this row; a
  // worktree-project loaded standalone (filter mode) is its own row and
  // doesn't have a parent to ambient-highlight.
  const childProjectIds = useMemo(
    () => new Set((childProjects ?? []).map((c) => c.id)),
    [childProjects]
  )
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const isDirectlyActive = activeProjectId === project.id
  const isAmbientActive = activeProjectId !== null && childProjectIds.has(activeProjectId)
  const isActive = isDirectlyActive || isAmbientActive
  const branch = useGitBranch(project.path)
  const { sessions, openTabs, activeCount, hasActive, lastActivity } = activity
  // A worktree row shares its origin's color (see colorSourceProject); resolve
  // it so the avatar, the picker's selected swatch, and writes all target the
  // same project the tab-color resolution actually reads.
  const colorSource = colorSourceProject(project, allProjectsForColor)
  const avatarColor = deriveAvatarColor(colorSource.tabColor)
  const avatarInitials = getAvatarInitials(project.name)
  // Only top-level origin projects can be pinned. Worktree children ride with
  // their parent — pinning a child has no defined semantics.
  const canPin = !isWorktreeProject

  const defaults: WorktreeDefaults = (() => {
    const override = project.worktreeOverrides
    if (!override) return globalDefaults
    return {
      locationPattern: override.locationPattern ?? globalDefaults.locationPattern,
      envFiles:
        override.envFiles === null || override.envFiles === undefined
          ? globalDefaults.envFiles
          : override.envFiles,
      setupScript: override.setupScript ?? globalDefaults.setupScript,
      afterCreate: override.afterCreate ?? globalDefaults.afterCreate
    }
  })()

  const handleFocusTab = (tabId: string, groupId: string): void => {
    setActiveGroup(groupId)
    setActiveTerminalInGroup(groupId, tabId)
  }

  // Per-project mixed-provider detection (Option B avatar rule). When the
  // project's session list spans more than one provider, child rows show
  // their provider corner badge to disambiguate; otherwise they stay quiet.
  const inlineMixedProviders = useMemo(() => isMixedProviderList(sessions), [sessions])

  // Whether the parent project's "main checkout" has any recent (idle)
  // sessions worth surfacing. Used to decide if the main-checkout
  // `WorktreeSection` should mount when only recents (and no active rows
  // or tabs) match — without this the section would silently swallow
  // recent sessions on projects that have worktrees.
  const hasMainCheckoutRecents = useMemo(
    () =>
      showRecentInProject &&
      selectRecentSessions(sessions, openTabs, {
        limit: recentSessionsCount,
        hideEmpty: hideEmptySessions
      }).length > 0,
    [sessions, openTabs, showRecentInProject, recentSessionsCount, hideEmptySessions]
  )

  // Neighbor sibling ids for "Move up / Move down" are supplied by the parent
  // ProjectList, which already knows the rendered top-level order (and thus
  // correctly skips hidden worktree children). Computing here would subscribe
  // the whole list to store changes and could target invisible rows.

  return (
    <div data-reorderable-id={project.id} className="mb-0.5 relative">
      {/* Project row — its own selection target. The entire vertical accent
          bar and gradient card that previously wrapped this + the expanded
          body have been removed; selection/expansion now styles the row
          alone, and the expanded body hangs below with an indent + dashed
          guide line (matches the mockup's `.proj-children`). */}
      <div
        ref={tagPickerAnchorRef}
        data-project-id={project.id}
        className="group flex items-center gap-2.5 pl-3 pr-2.5 py-2 cursor-pointer relative rounded-lg transition-colors"
        style={{
          backgroundColor: isActive
            ? 'var(--dplex-accent-soft)'
            : isExpanded
              ? 'var(--dplex-bg-alt)'
              : undefined
        }}
        onMouseEnter={(e) => {
          if (!isActive && !isExpanded) {
            e.currentTarget.style.backgroundColor = 'var(--dplex-hover)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive && !isExpanded) {
            e.currentTarget.style.backgroundColor = ''
          }
        }}
        onClick={() => {
          // Snapshot expansion + emphasis BEFORE side effects. The
          // `focusFirstTabForPaths` call below switches the active tab,
          // which synchronously triggers the `useTerminalStore`
          // subscriber that auto-expands the matching project. Reading
          // store state after that would mis-classify a freshly-clicked
          // collapsed project as "already expanded" and immediately
          // collapse it again.
          const wasExpandedBefore = useProjectStore.getState().expandedProjectIds.has(project.id)
          const wasEmphasizedBefore =
            useProjectStore.getState().lastExpandedProjectId === project.id

          setActiveProject(project.id)
          {
            const paths = new Set<string>([project.path])
            if (childProjects) for (const c of childProjects) paths.add(c.path)
            focusFirstTabForPaths(paths)
          }

          if (!wasExpandedBefore) {
            // Was collapsed → expand (subscriber may have already done
            // so; toggleExpanded is idempotent for the expand direction
            // because it checks current state).
            const liveState = useProjectStore.getState()
            if (!liveState.expandedProjectIds.has(project.id)) {
              toggleExpanded(project.id)
            } else if (liveState.lastExpandedProjectId !== project.id) {
              setLastExpanded(project.id)
            }
          } else if (!wasEmphasizedBefore) {
            // Was expanded but not emphasized → promote (don't collapse).
            setLastExpanded(project.id)
          } else {
            // Was expanded AND emphasized → user is asking to collapse.
            toggleExpanded(project.id)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenuPos({ x: e.clientX, y: e.clientY })
          setShowMenu(true)
        }}
      >
        {/* Active project gets a v2 left accent stripe — matches the
            activity-bar / search-palette active treatment. Replaces the
            previous full-ring + inset shadow, which read as a separate
            UI element rather than a selection state. */}
        {isActive && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              top: 6,
              bottom: 6,
              width: 2,
              borderRadius: '0 2px 2px 0',
              backgroundColor: 'var(--dplex-accent)',
              boxShadow: '0 0 8px var(--dplex-accent-glow)',
              pointerEvents: 'none'
            }}
          />
        )}
        {/* Project avatar — deterministic color per project id. Anchored
            to the top of the row (via self-start + a small top offset
            that visually centers it against the two-line content) so it
            doesn't drift downward when the hover-revealed tag row
            expands the card. */}
        <span
          aria-hidden
          data-project-avatar={project.id}
          className="flex-shrink-0 self-start relative flex items-center justify-center rounded-md text-[10.5px] font-bold leading-none"
          style={{
            width: 26,
            height: 26,
            marginTop: 3,
            backgroundColor: avatarColor.bg,
            color: avatarColor.fg,
            border: `1px solid ${avatarColor.border}`
          }}
        >
          {avatarInitials}
          {(() => {
            const liveCount = activeCount > 0 ? activeCount : openTabs.length
            if (liveCount === 0) return null
            const isLive = activeCount > 0
            // Aggregate the highest-priority status across this project's
            // own sessions plus any worktree-child sessions, so the dot
            // surfaces "needs approval" / "waiting for input" sub-states
            // instead of always reading as plain "live green".
            const allSessions = isLive
              ? [
                  ...sessions,
                  ...(childProjects && getActivity
                    ? childProjects.flatMap((c) => getActivity(c.path).sessions)
                    : [])
                ]
              : []
            const visual = isLive ? aggregateVisual(allSessions) : 'idle'
            const dotColor = !isLive
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
                  bottom: -2,
                  right: -2,
                  width: 9,
                  height: 9,
                  backgroundColor: dotColor,
                  border: '1.5px solid var(--dplex-bg-panel)'
                }}
                title={`${liveCount} ${isLive ? 'live ' : ''}session${liveCount === 1 ? '' : 's'}`}
              />
            )
          })()}
        </span>

        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          {/* Line 1: project name */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="text-[13px] font-semibold truncate tracking-tight"
              style={{ color: 'var(--dplex-text)' }}
            >
              {project.name}
            </span>
          </div>

          {/* Line 2: metadata subline — branch · time · tag dots. Compact
              format matches the mockup: just a number for sessions (no
              "session(s)" suffix that wraps + truncates ugly on long
              branch names) and a suffix-free relative time on the right.
              Tag dots (option A) sit at the end so a tagged project is
              the same height as an untagged one — no row expansion on
              hover. Full tag chips remain available in the tag-picker
              popover for editing. */}
          <div
            className="flex items-center gap-1.5 min-w-0 text-[11px]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            {branch && (
              <span className="flex items-center gap-1 min-w-0">
                <GitBranch size={9} className="flex-shrink-0" />
                <span className="truncate">{branch}</span>
              </span>
            )}
            {lastActivity &&
              (() => {
                const rel = relativeTimeShort(lastActivity)
                return (
                  <>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span className="tabular-nums flex-shrink-0">{rel}</span>
                  </>
                )
              })()}
            {project.tags && project.tags.length > 0 && <TagDots tags={project.tags} />}
          </div>
        </div>

        {/* Chevron — right-aligned, grey. Clicking always toggles expansion,
            even when the card click is being reinterpreted as "promote". */}
        {/* Action buttons — slotted left of the chevron on hover so the
            chevron stays clickable. Absolute-positioned so they don't
            reserve space when hidden; the small bg + shadow masks any
            meta text underneath. */}
        <div
          className="absolute right-9 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-md px-0.5 py-0.5 z-10"
          style={{
            backgroundColor: 'var(--dplex-bg-panel)',
            boxShadow: '0 0 6px 2px var(--dplex-bg-panel)'
          }}
        >
          {primaryProvider && (
            <button
              key={primaryProvider.id}
              onClick={(e) => {
                e.stopPropagation()
                startProjectSession(project, primaryProvider.id)
              }}
              className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
              style={{ color: 'var(--dplex-text-muted)' }}
              title={`Start ${primaryProvider.name}`}
            >
              <Play size={11} />
            </button>
          )}
          <button
            ref={menuAnchorRef}
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
            style={{ color: 'var(--dplex-text-muted)' }}
            title="More actions"
          >
            <MoreVertical size={11} />
          </button>
        </div>

        {/* Chevron — right-aligned, always visible so the user can collapse
            the project with a single click without competing with the
            hover-revealed action buttons. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(project.id)
          }}
          style={{ color: 'var(--dplex-text-muted)' }}
          className="flex-shrink-0 cursor-pointer p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
          aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Virtual anchor for right-click context menu. Positioned at the
            cursor so the PopoverMenu opens where the user clicked. */}
        {contextMenuPos && (
          <div
            ref={contextAnchorRef}
            aria-hidden
            style={{
              position: 'fixed',
              left: contextMenuPos.x,
              top: contextMenuPos.y,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Context menu */}
        <PopoverMenu
          anchorRef={contextMenuPos ? contextAnchorRef : menuAnchorRef}
          align={contextMenuPos ? 'left' : 'right'}
          open={showMenu}
          onClose={() => {
            setShowMenu(false)
            setContextMenuPos(null)
          }}
          className="min-w-[160px]"
        >
          {primaryProvider && (
            <button
              key={primaryProvider.id}
              onClick={(e) => {
                e.stopPropagation()
                startProjectSession(project, primaryProvider.id)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
              style={{ color: 'var(--dplex-text)' }}
            >
              <Play size={11} /> Start {primaryProvider.name}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              openProjectTerminal(project)
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <Terminal size={11} /> Open Terminal
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              // Surface this project's changes in the Git panel — making it
              // the active project binds the panel, and `expand()` ensures
              // the panel is visible (no-op if already expanded).
              setActiveProject(project.id)
              useGitPanelStore.getState().expand()
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <GitCompare size={11} /> Show in Git Panel
          </button>

          <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />

          {/* Worktree operations — differ by origin vs worktree-project. */}
          {!isWorktreeProject && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setNewWtOpen(true)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                style={{ color: 'var(--dplex-text)' }}
              >
                <GitFork size={11} /> New worktree…
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setManageOpen(true)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                style={{ color: 'var(--dplex-text)' }}
              >
                <Settings2 size={11} /> Manage worktrees…
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setDefaultsOpen(true)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                style={{ color: 'var(--dplex-text)' }}
              >
                <Settings2 size={11} /> Worktree defaults…
              </button>
              <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
            </>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(project.path)
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <Copy size={11} /> Copy Path
          </button>
          {branch && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(branch)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
              style={{ color: 'var(--dplex-text)' }}
            >
              <GitBranch size={11} /> Copy Branch
            </button>
          )}

          <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(false)
              setContextMenuPos(null)
              setTagPickerOpen(true)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <TagIcon size={11} /> Tags…
          </button>

          {/* Project-wide tab color — tints every tab of this project (main
              checkout + worktrees). Individual tabs can override via their own
              right-click menu. */}
          <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
          <div
            className="px-3 pt-0.5 pb-1 text-[10px] font-semibold uppercase"
            style={{ color: 'var(--dplex-text-faint)', letterSpacing: '0.08em' }}
          >
            Tab color
          </div>
          <div className="flex items-center gap-1.5 px-3 pb-2">
            {TAB_COLORS.map((c) => {
              const selected = colorSource.tabColor === c.value
              return (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-pressed={selected}
                  onClick={(e) => {
                    e.stopPropagation()
                    setProjectTabColor(colorSource.id, c.value)
                    setShowMenu(false)
                    setContextMenuPos(null)
                  }}
                  className="rounded-full transition-transform hover:scale-110"
                  style={{
                    width: 16,
                    height: 16,
                    backgroundColor: c.value,
                    boxShadow: selected ? `0 0 0 2px var(--dplex-bg), 0 0 0 3px ${c.value}` : 'none'
                  }}
                />
              )
            })}
            <button
              type="button"
              title="No color"
              aria-label="Clear project tab color"
              onClick={(e) => {
                e.stopPropagation()
                setProjectTabColor(colorSource.id, null)
                setShowMenu(false)
                setContextMenuPos(null)
              }}
              className="grid place-items-center rounded-full hover:bg-[var(--dplex-hover)]"
              style={{
                width: 16,
                height: 16,
                border: '1px solid var(--dplex-border-strong)',
                color: 'var(--dplex-text-muted)'
              }}
            >
              <X size={10} />
            </button>
          </div>

          {canPin && (
            <>
              <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(project.id)
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                style={{ color: 'var(--dplex-text)' }}
              >
                {project.pinned ? (
                  <>
                    <PinOff size={11} /> Unpin
                  </>
                ) : (
                  <>
                    <Pin size={11} /> Pin to top
                  </>
                )}
              </button>
              <button
                disabled={!moveUpTargetId}
                onClick={(e) => {
                  e.stopPropagation()
                  if (moveUpTargetId) reorderProject(project.id, moveUpTargetId, 'above')
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                style={{ color: 'var(--dplex-text)' }}
              >
                <ArrowUp size={11} /> Move up
              </button>
              <button
                disabled={!moveDownTargetId}
                onClick={(e) => {
                  e.stopPropagation()
                  if (moveDownTargetId) reorderProject(project.id, moveDownTargetId, 'below')
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                style={{ color: 'var(--dplex-text)' }}
              >
                <ArrowDown size={11} /> Move down
              </button>
            </>
          )}

          <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />

          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isWorktreeProject) {
                setRemoveWtOpen(true)
              } else {
                removeProject(project.id)
              }
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--dplex-hover)]"
          >
            <Trash2 size={11} /> {isWorktreeProject ? 'Remove worktree…' : 'Remove Project'}
          </button>
        </PopoverMenu>

        <TagPickerPopover
          projectId={project.id}
          open={tagPickerOpen}
          onClose={() => setTagPickerOpen(false)}
          anchorRef={tagPickerAnchorRef}
        />
      </div>

      {/* Expanded body — nested under the project row with a dashed left
          guide line. Replaces the previous accordion-card layout that
          wrapped the project header + body in a single bordered container.
          Indent shrinks at narrow panel widths so worktree-section labels
          have actual room to truncate into. */}
      {isExpanded && (
        <div
          style={{
            margin: '6px 0 6px 12px',
            paddingLeft: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 0
          }}
        >
          {childProjects && childProjects.length > 0 && getActivity ? (
            <>
              {/* Parent's "main checkout" section — shown when worktrees exist
                  so the user can distinguish sessions running on main from
                  worktree-scoped sessions. Always visible, label = parent name. */}
              {(hasActive || openTabs.length > 0 || hasMainCheckoutRecents) && (
                <WorktreeSection
                  project={project}
                  parentProject={project}
                  sessions={sessions}
                  openTabs={openTabs}
                  visual={aggregateVisual(sessions)}
                  providers={providers}
                  isMainCheckout
                  mainBranchOverride={branch}
                />
              )}
              {childProjects.map((child) => {
                const childActivity = getActivity(child.path)
                return (
                  <WorktreeSection
                    key={child.id}
                    project={child}
                    parentProject={project}
                    sessions={childActivity.sessions}
                    openTabs={childActivity.openTabs}
                    visual={aggregateVisual(childActivity.sessions)}
                    providers={providers}
                  />
                )
              })}
            </>
          ) : (
            <ProjectSessionList
              scopeId={project.id}
              sessions={sessions}
              openTabs={openTabs}
              providers={providers}
              showProviderBadge={inlineMixedProviders}
              emptyMessage={!hasActive && openTabs.length === 0 ? 'No active sessions.' : undefined}
              onFocusTab={handleFocusTab}
              onDeleteSession={deleteSession}
              onShowPrompts={setPromptsSession}
            />
          )}
        </div>
      )}

      {/* Prompts dialog for project sessions */}
      {promptsSession && (
        <PromptsDialog
          sessionId={promptsSession.id}
          sessionName={promptsSession.displayName}
          providerId={promptsSession.aiTool}
          onClose={() => setPromptsSession(null)}
        />
      )}

      {/* Worktree creation modal (origin only). */}
      {newWtOpen && repoRoot && (
        <NewWorktreeModal
          project={project}
          repoRoot={repoRoot}
          defaults={defaults}
          providers={providers}
          onClose={() => setNewWtOpen(false)}
          onCreated={(result) => {
            setNewWtOpen(false)
            void handleWorktreeCreated({
              originProject: project,
              worktreePath: result.worktreePath,
              branch: result.branch,
              afterCreate: result.afterCreate,
              providerId: result.providerId,
              setupScript: result.setupScript,
              createdByDplexWorktree: true,
              originSpaceId: result.originSpaceId
            })
          }}
        />
      )}

      {manageOpen && (
        <ManageWorktreesModal
          originProject={project}
          providers={providers}
          onClose={() => setManageOpen(false)}
        />
      )}

      {defaultsOpen && (
        <ProjectWorktreeDefaultsModal project={project} onClose={() => setDefaultsOpen(false)} />
      )}

      {removeWtOpen && (
        <RemoveWorktreeProjectModal
          project={project}
          repoRoot={repoRoot}
          onClose={() => setRemoveWtOpen(false)}
          onRemoved={() => setRemoveWtOpen(false)}
        />
      )}
    </div>
  )
}
