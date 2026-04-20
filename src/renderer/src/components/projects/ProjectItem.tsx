import { useState, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Play,
  GitBranch,
  GripVertical,
  MoreVertical,
  Terminal,
  Copy,
  Trash2,
  GitFork,
  Settings2,
  FolderOpen
} from 'lucide-react'
import type { Project, AISession, ProviderInfo, WorktreeDefaults } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useWorktrees } from '../../hooks/useWorktrees'
import { STATUS_ACTIVE_COLOR, STATUS_ACTIVE_BG } from '../../utils/statusColors'
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
  isDragging: boolean
  dragOverPosition: 'above' | 'below' | null
  /** Nesting depth (0 = origin, 1 = worktree-project). Drives the indent. */
  indent?: number
  /** Parent project record — used by "Open origin". */
  parentProject?: Project
  /** Worktree-child projects to render inline within this project's expanded body. */
  childProjects?: Project[]
  /** Resolves activity for a child project path. */
  getActivity?: (path: string) => ProjectActivity
  onDragStart: (id: string) => void
  onDragOver: (id: string, e: React.DragEvent) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
}

function relativeTime(date: Date | undefined): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ProjectItem({
  project,
  activity,
  providers,
  isDragging,
  dragOverPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  indent = 0,
  parentProject,
  childProjects,
  getActivity
}: ProjectItemProps): React.JSX.Element {
  const expandedIds = useProjectStore((s) => s.expandedProjectIds)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const removeProject = useProjectStore((s) => s.removeProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const globalDefaults = useSettingsStore((s) => s.settings.worktreeDefaults)
  const [canDrag, setCanDrag] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const [newWtOpen, setNewWtOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [removeWtOpen, setRemoveWtOpen] = useState(false)
  const dragHandleRef = useRef<HTMLSpanElement>(null)
  const menuAnchorRef = useRef<HTMLButtonElement>(null)

  const isWorktreeProject = Boolean(project.parentProjectId || project.parentRepoPath)
  // Only subscribe to worktree info when we actually need it (for the modal
  // or for disk-deletion) — avoids a watcher for every worktree-project.
  const needWtWatch = newWtOpen || manageOpen || removeWtOpen
  const watchPath = isWorktreeProject ? (parentProject?.path ?? project.parentRepoPath ?? project.path) : project.path
  const { repoRoot } = useWorktrees(needWtWatch ? watchPath : undefined)

  const isExpanded = expandedIds.has(project.id)
  const branch = useGitBranch(project.path)
  const { sessions, openTabs, activeCount, hasActive, lastActivity } = activity
  // Worktree children render compactly: a single-line row with a left thread
  // line connecting them to the origin project. Sessions hang off that thread.
  const isCompact = isWorktreeProject && indent > 0

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

  const focusOrigin = (): void => {
    if (!parentProject) return
    // Scroll the origin project into view and flash-highlight it.
    const el = document.querySelector(`[data-project-id="${parentProject.id}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div
      data-reorderable-id={project.id}
      className={isCompact ? 'relative' : 'mb-2 rounded-sm overflow-hidden'}
      style={{
        opacity: isDragging ? 0.4 : 1,
        marginLeft: indent ? indent * 16 : undefined,
        backgroundColor: isCompact ? undefined : 'var(--dplex-bg-alt)',
        border: isCompact ? undefined : '1px solid var(--dplex-border)'
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

      {/* Drop indicator above */}
      {dragOverPosition === 'above' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}

      {/* Project section header */}
      <div
        data-project-id={project.id}
        className={
          isCompact
            ? 'group flex items-center gap-1.5 pl-4 pr-2 py-1 cursor-pointer relative rounded-sm hover:bg-[var(--dplex-hover)]'
            : 'group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer relative'
        }
        style={
          isCompact || !isExpanded ? undefined : { borderBottom: '1px solid var(--dplex-border)' }
        }
        draggable={canDrag}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          onDragStart(project.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDragOver(project.id, e)
        }}
        onDrop={(e) => {
          e.preventDefault()
          onDrop(project.id)
        }}
        onDragEnd={() => {
          setCanDrag(false)
          onDragEnd()
        }}
        onClick={() => toggleExpanded(project.id)}
      >
        {/* Drag handle — hidden for worktree children (they stay with parent). */}
        {!isCompact && (
          <span
            ref={dragHandleRef}
            className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity"
            style={{ color: 'var(--dplex-text-muted)' }}
            onMouseDown={() => setCanDrag(true)}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={11} />
          </span>
        )}

        {/* Chevron */}
        <span style={{ color: 'var(--dplex-accent)' }} className="flex-shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Branch icon — only for worktree children, where the name IS the branch. */}
        {isCompact && (
          <GitBranch
            size={10}
            className="flex-shrink-0"
            style={{ color: 'var(--dplex-text-muted)' }}
          />
        )}

        {/* Name + count */}
        <span
          className={
            isCompact ? 'text-[11px] font-medium truncate' : 'text-[11px] font-semibold truncate'
          }
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
        {activeCount > 0 && (
          <span
            className="text-[10px] font-semibold flex-shrink-0 min-w-[16px] text-center px-1 rounded-full"
            style={{ color: STATUS_ACTIVE_COLOR, backgroundColor: STATUS_ACTIVE_BG }}
          >
            {activeCount}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons — always visible */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
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

        {/* Context menu */}
        <PopoverMenu
          anchorRef={menuAnchorRef}
          open={showMenu}
          onClose={() => setShowMenu(false)}
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
          {isWorktreeProject && parentProject && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  focusOrigin()
                  setShowMenu(false)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
                style={{ color: 'var(--dplex-text)' }}
              >
                <FolderOpen size={11} /> Open origin project
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
          {/* Branch + last activity info — origin only. For worktree children
              the branch IS the name and the time sits on the collapsed row. */}
          {!isCompact && (branch || lastActivity) && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 text-[10px]"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              {branch && (
                <span className="flex items-center gap-0.5">
                  <GitBranch size={10} className="flex-shrink-0" />
                  <span className="truncate">{branch}</span>
                </span>
              )}
              {lastActivity && (
                <>
                  {branch && <span style={{ opacity: 0.4 }}>·</span>}
                  <span className="flex-shrink-0">{relativeTime(lastActivity)}</span>
                </>
              )}
            </div>
          )}

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
                  isDragging={false}
                  dragOverPosition={null}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={onDragEnd}
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
        <ProjectWorktreeDefaultsModal
          project={project}
          onClose={() => setDefaultsOpen(false)}
        />
      )}

      {removeWtOpen && (
        <RemoveWorktreeProjectModal
          project={project}
          repoRoot={repoRoot}
          onClose={() => setRemoveWtOpen(false)}
          onRemoved={() => setRemoveWtOpen(false)}
        />
      )}

      {/* Drop indicator below */}
      {dragOverPosition === 'below' && (
        <div className="mx-2 h-0.5 rounded" style={{ backgroundColor: 'var(--dplex-accent)' }} />
      )}
    </div>
  )
}
