import { useState, useRef, useEffect } from 'react'
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
  ArrowDown
} from 'lucide-react'
import type { Project, AISession, ProviderInfo, WorktreeDefaults } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useWorktrees } from '../../hooks/useWorktrees'
import { STATUS_ACTIVE_COLOR, STATUS_ACTIVE_BG } from '../../utils/statusColors'
import {
  getAvatarColor,
  getAvatarInitials
} from '../../utils/projectStatus'
import { SessionItem } from '../sessions/SessionItem'
import { PromptsDialog } from '../sessions/PromptsDialog'
import type { ProjectActivity } from '../../hooks/useProjectSessions'
import { normalizePath } from '../../hooks/useProjectSessions'
import { PopoverMenu } from '../common/PopoverMenu'
import { NewWorktreeModal } from '../worktrees/NewWorktreeModal'
import { ManageWorktreesModal } from '../worktrees/ManageWorktreesModal'
import { RemoveWorktreeProjectModal } from '../worktrees/RemoveWorktreeProjectModal'
import { ProjectWorktreeDefaultsModal } from '../worktrees/ProjectWorktreeDefaultsModal'
import { handleWorktreeCreated } from '../../services/worktreePostCreate'

interface ProjectItemProps {
  project: Project
  activity: ProjectActivity
  providers: ProviderInfo[]
  /** Nesting depth (0 = origin, 1 = worktree-project). Drives the indent. */
  indent?: number
  /** Parent project record — used by "Open origin". */
  parentProject?: Project
  /** Worktree-child projects to render inline within this project's expanded body. */
  childProjects?: Project[]
  /** Resolves activity for a child project path. */
  getActivity?: (path: string) => ProjectActivity
  /** Id of the previous top-level sibling in the same pinned group (for "Move up"). */
  moveUpTargetId?: string | null
  /** Id of the next top-level sibling in the same pinned group (for "Move down"). */
  moveDownTargetId?: string | null
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
  indent = 0,
  parentProject,
  childProjects,
  getActivity,
  moveUpTargetId = null,
  moveDownTargetId = null
}: ProjectItemProps): React.JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const setLastExpanded = useProjectStore((s) => s.setLastExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const togglePin = useProjectStore((s) => s.togglePin)
  const reorderProject = useProjectStore((s) => s.reorderProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const globalDefaults = useSettingsStore((s) => s.settings.worktreeDefaults)
  const [showMenu, setShowMenu] = useState(false)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const [newWtOpen, setNewWtOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [removeWtOpen, setRemoveWtOpen] = useState(false)
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
  const watchPath = isWorktreeProject
    ? (parentProject?.path ?? project.parentRepoPath ?? project.path)
    : project.path
  const { repoRoot } = useWorktrees(needWtWatch ? watchPath : undefined)

  const isExpanded = expandedIds.has(project.id)
  const lastExpandedId = useProjectStore((s) => s.lastExpandedProjectId)
  const isLastExpanded = isExpanded && lastExpandedId === project.id
  const branch = useGitBranch(project.path)
  const { sessions, openTabs, activeCount, hasActive, lastActivity } = activity
  // Worktree children render compactly: a single-line row with a left thread
  // line connecting them to the origin project. Sessions hang off that thread.
  const isCompact = isWorktreeProject && indent > 0
  const avatarColor = !isCompact ? getAvatarColor(project.id) : null
  const avatarInitials = avatarColor ? getAvatarInitials(project.name) : null
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

  // Neighbor sibling ids for "Move up / Move down" are supplied by the parent
  // ProjectList, which already knows the rendered top-level order (and thus
  // correctly skips hidden worktree children). Computing here would subscribe
  // the whole list to store changes and could target invisible rows.

  return (
    <div
      data-reorderable-id={project.id}
      className={
        isCompact
          ? 'relative'
          : isExpanded
            ? 'mb-1.5 rounded-lg overflow-hidden relative'
            : 'mb-0.5 rounded-lg relative'
      }
      style={{
        marginLeft: indent ? indent * 16 : undefined,
        // Collapsed rows blend with the container; only expanded cards get a
        // subtle gradient + border to stand out (mirrors the mockup).
        // The most recently expanded project gets a stronger accent border
        // + subtle glow so the user can tell which one they just opened.
        background: isCompact
          ? undefined
          : isExpanded
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--dplex-status-active-bg) 10%, var(--dplex-bg)) 0%, var(--dplex-bg) 50%, var(--dplex-bg-alt) 100%)'
            : undefined,
        border: isCompact
          ? undefined
          : isLastExpanded
            ? '1px solid color-mix(in srgb, var(--dplex-accent) 55%, var(--dplex-border))'
            : isExpanded
              ? '1px solid var(--dplex-border)'
              : undefined,
        boxShadow: isLastExpanded
          ? '0 0 0 1px color-mix(in srgb, var(--dplex-accent) 20%, transparent)'
          : undefined
      }}
    >
      {/* Thread line connecting the worktree row to the parent project. */}
      {isCompact && (
        <>
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: 6,
              top: 0,
              bottom: isExpanded ? 0 : '50%',
              borderLeft: '1px solid var(--dplex-border)'
            }}
          />
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: 6,
              top: 14,
              width: 8,
              borderTop: '1px solid var(--dplex-border)'
            }}
          />
        </>
      )}

      {/* Project section header */}
      <div
        data-project-id={project.id}
        className={
          isCompact
            ? 'group flex items-center gap-1.5 pl-4 pr-2 py-1 cursor-pointer relative rounded-sm hover:bg-[var(--dplex-hover)]'
            : isExpanded
              ? 'group flex items-center gap-2.5 pl-3 pr-2.5 py-2 cursor-pointer relative'
              : 'group flex items-center gap-2.5 pl-3 pr-2.5 py-2 cursor-pointer relative rounded-lg hover:bg-[var(--dplex-hover)]'
        }
        style={
          isCompact || !isExpanded ? undefined : { borderBottom: '1px solid var(--dplex-border)' }
        }
        onClick={() => {
          // Clicking an already-expanded card that isn't the emphasized one
          // promotes it instead of collapsing. Chevron still toggles.
          if (isExpanded && !isLastExpanded) {
            setLastExpanded(project.id)
          } else {
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
        {/* Rich-mode avatar (origin rows only). Deterministic color per project id. */}
        {avatarColor && avatarInitials && (
          <span
            aria-hidden
            className="flex-shrink-0 flex items-center justify-center rounded-md text-[10.5px] font-bold leading-none"
            style={{
              width: 26,
              height: 26,
              backgroundColor: avatarColor.bg,
              color: avatarColor.fg
            }}
          >
            {avatarInitials}
          </span>
        )}

        {/* Branch icon — only for worktree children, where the name IS the branch. */}
        {isCompact && (
          <GitBranch
            size={10}
            className="flex-shrink-0"
            style={{ color: 'var(--dplex-text-muted)' }}
          />
        )}

        {/* Compact (worktree child) rows stay single-line. Origin rows use a
            two-line layout: name on top, metadata subline below. */}
        {isCompact ? (
          <>
            <span
              className="text-[11px] font-medium truncate"
              style={{ color: 'var(--dplex-text)' }}
            >
              {project.name}
              {isWorktreeProject && !parentProject && project.parentRepoName && (
                <span
                  className="ml-1 font-normal"
                  style={{ color: 'var(--dplex-text-muted)', opacity: 0.7 }}
                >
                  ({project.parentRepoName})
                </span>
              )}
            </span>
            {hasActive && (
              <>
                <span
                  aria-hidden
                  className="flex-shrink-0 rounded-full dplex-pulse-dot"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: STATUS_ACTIVE_COLOR,
                    boxShadow: `0 0 0 3px ${STATUS_ACTIVE_BG}`
                  }}
                />
                {activeCount > 0 && (
                  <span
                    className="text-[10px] font-semibold flex-shrink-0 min-w-[16px] text-center px-1 rounded-full"
                    style={{ color: STATUS_ACTIVE_COLOR, backgroundColor: STATUS_ACTIVE_BG }}
                  >
                    {activeCount}
                  </span>
                )}
              </>
            )}
            <div className="flex-1" />
          </>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            {/* Line 1: project name + pulse dot when live */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="text-[13px] font-semibold truncate tracking-tight"
                style={{ color: 'var(--dplex-text)' }}
              >
                {project.name}
              </span>
              {hasActive && (
                <span
                  aria-hidden
                  className="flex-shrink-0 rounded-full dplex-pulse-dot"
                  style={{
                    width: 7,
                    height: 7,
                    backgroundColor: STATUS_ACTIVE_COLOR
                  }}
                  title={`${activeCount} live session${activeCount === 1 ? '' : 's'}`}
                />
              )}
            </div>

            {/* Line 2: metadata subline — branch · session summary · last activity */}
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
              {branch && <span style={{ opacity: 0.5 }}>·</span>}
              <span className="truncate">
                {hasActive
                  ? `${activeCount} session${activeCount === 1 ? '' : 's'}`
                  : sessions.length > 0
                    ? 'idle'
                    : 'no active'}
              </span>
              {lastActivity && (() => {
                const rel = relativeTimeShort(lastActivity)
                return (
                  <>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span className="tabular-nums flex-shrink-0">
                      {rel === 'now' ? 'just now' : `${rel} ago`}
                    </span>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* Chevron — right-aligned, grey. Clicking always toggles expansion,
            even when the card click is being reinterpreted as "promote". */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleExpanded(project.id)
          }}
          style={{ color: 'var(--dplex-text-muted)' }}
          className="flex-shrink-0 opacity-100 group-hover:opacity-0 transition-opacity cursor-pointer"
          aria-label={isExpanded ? 'Collapse project' : 'Expand project'}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {/* Action buttons — overlay on hover so they don't reserve space when hidden. */}
        <div
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-md px-0.5 py-0.5"
          style={{
            backgroundColor: 'var(--dplex-bg)',
            boxShadow: '0 0 6px 2px var(--dplex-bg-alt)'
          }}
        >
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation()
                startAISession(project, p.id)
              }}
              className="p-1 hover:bg-[var(--dplex-hover)] rounded transition-colors"
              style={{ color: 'var(--dplex-text-muted)' }}
              title={`Start ${p.name}`}
            >
              <Play size={11} />
            </button>
          ))}
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
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation()
                startAISession(project, p.id)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
              style={{ color: 'var(--dplex-text)' }}
            >
              <Play size={11} /> Start {p.name}
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation()
              createTerminal(undefined, project.name, undefined, undefined, project.path)
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <Terminal size={11} /> Open Terminal
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
      </div>

      {/* Expanded: sessions */}
      {isExpanded && (
        <div
          style={{
            backgroundColor: 'transparent',
            // Indent the compact body so sessions align under the worktree
            // name; the outer thread line (rendered on the row container) is
            // the single vertical rule — no second borderLeft here.
            marginLeft: isCompact ? 18 : undefined
          }}
        >
          {!hasActive && openTabs.length === 0 ? (
            <div
              className="px-3 py-1.5 text-[10px]"
              style={{ color: 'var(--dplex-text-muted)', opacity: 0.7 }}
            >
              No active sessions.
            </div>
          ) : (
            (() => {
              // Pair each open tab to an AI session. First by explicit sessionId,
              // then fall back to CWD + provider when the resolver hasn't caught
              // up yet (avoids rendering a placeholder + the session separately).
              const claimed = new Set<string>()
              const pairs = openTabs.map((tab) => {
                let match = tab.sessionId ? sessions.find((s) => s.id === tab.sessionId) : undefined
                if (!match) {
                  match = sessions.find((s) => {
                    if (claimed.has(s.id)) return false
                    if (s.status !== 'active') return false
                    if (!s.cwd || !tab.cwd) return false
                    if (normalizePath(s.cwd) !== normalizePath(tab.cwd)) return false
                    const cmd = tab.command?.toLowerCase() ?? ''
                    return cmd.length === 0 || cmd.includes(s.aiTool.toLowerCase())
                  })
                }
                if (match) claimed.add(match.id)
                return { tab, match }
              })
              const unpaired = sessions.filter((s) => s.status === 'active' && !claimed.has(s.id))
              return (
                <>
                  {pairs.map(({ tab, match }) =>
                    match ? (
                      <SessionItem
                        key={tab.id}
                        session={match}
                        onDelete={deleteSession}
                        onShowPrompts={setPromptsSession}
                        compact
                        onClick={() => handleFocusTab(tab.id, tab.groupId)}
                      />
                    ) : (
                      <div
                        key={tab.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--dplex-hover)] cursor-pointer rounded-sm mx-1"
                        onClick={() => handleFocusTab(tab.id, tab.groupId)}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: STATUS_ACTIVE_COLOR }}
                        />
                        <span className="text-xs truncate" style={{ color: 'var(--dplex-text)' }}>
                          {tab.title}
                        </span>
                      </div>
                    )
                  )}
                  {unpaired.map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      onDelete={deleteSession}
                      onShowPrompts={setPromptsSession}
                      compact
                    />
                  ))}
                </>
              )
            })()
          )}

          {/* Worktree children — rendered inline inside this project's card so
              they visually belong to it (origin only). */}
          {!isCompact && childProjects && childProjects.length > 0 && getActivity && (
            <div className="pb-1">
              {childProjects.map((child) => (
                <ProjectItem
                  key={child.id}
                  project={child}
                  parentProject={project}
                  indent={1}
                  activity={getActivity(child.path)}
                  providers={providers}
                />
              ))}
            </div>
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
              createdByDplexWorktree: true
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
