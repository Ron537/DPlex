import { useRef, useState, type JSX } from 'react'
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Trash2,
  Copy,
  Play,
  Terminal,
  GitCompare
} from 'lucide-react'
import type { AISession, Project, ProviderInfo } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useGitPanelStore } from '../../stores/gitPanelStore'
import { PopoverMenu } from '../common/PopoverMenu'
import { StatusPill } from '../common/StatusPill'
import { type StatusVisual } from '../../utils/sessionStatusVisual'
import { isMixedProviderList } from '../../utils/providerHelpers'
import { pairTabsToSessions, type OpenTabWithGroup } from '../../utils/sessionPairing'
import { ProjectSessionList } from './ProjectSessionList'
import { RemoveWorktreeProjectModal } from '../worktrees/RemoveWorktreeProjectModal'
import { useWorktrees } from '../../hooks/useWorktrees'
import { useGitBranch } from '../../hooks/useGitBranch'
import { PromptsDialog } from '../sessions/PromptsDialog'

interface WorktreeSectionProps {
  /** Worktree project — its branch + dirname title the section header. */
  project: Project
  /** Origin/parent project — passed for right-click "remove worktree" anchoring. */
  parentProject: Project
  /** Sessions + open tabs already filtered to this worktree's scope. */
  sessions: AISession[]
  openTabs: OpenTabWithGroup[]
  /** Aggregate worktree status (most-active visual across its sessions). */
  visual: StatusVisual
  /** Provider registry — passed through to nested session rows. */
  providers: ProviderInfo[]
  /** When true, this section is the parent project's "main checkout" (no actual worktree). */
  isMainCheckout?: boolean
  /** Pre-resolved branch for main-checkout sections. Avoids subscribing to the same
   *  path twice when ProjectItem already has a `useGitBranch(project.path)` watcher. */
  mainBranchOverride?: string | null
}

/**
 * Renders Option A's worktree section: a labelled, collapsible header that
 * sits at the same indent as direct project sessions. Clicking the header
 * toggles the worktree's persisted expansion state. Right-click opens a
 * compact context menu scoped to this worktree.
 *
 * Visual is driven by the `.dplex-wt-head` class in main.css, mirroring
 * `.wt-head` in the HTML preview.
 */
export function WorktreeSection({
  project,
  parentProject,
  sessions,
  openTabs,
  visual,
  providers,
  isMainCheckout,
  mainBranchOverride
}: WorktreeSectionProps): JSX.Element {
  const collapsedSections = useProjectStore((s) => s.collapsedWorktreeSections)
  const toggleWorktreeSection = useProjectStore((s) => s.toggleWorktreeSection)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const startAISession = useProjectStore((s) => s.startAISession)
  const createTerminal = useTerminalStore((s) => s.createTerminal)
  const setActiveGroup = useTerminalStore((s) => s.setActiveGroup)
  const setActiveTerminalInGroup = useTerminalStore((s) => s.setActiveTerminalInGroup)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const defaultAITool = useSettingsStore((s) => s.settings.defaultAITool)
  const primaryProvider = providers.find((p) => p.id === defaultAITool) ?? providers[0]
  // The section's collapse key — main-checkout is keyed by the parent's
  // id with a `::main` suffix so it never clashes with a real worktree
  // project id. Collapsed-set semantics are inverted vs expandedProjectIds:
  // *not* in the set means **expanded** (default), so a freshly loaded
  // project shows its sections expanded without seeding state.
  const sectionId = isMainCheckout ? `${parentProject.id}::main` : project.id
  const isExpanded = !collapsedSections.has(sectionId)
  // Mirror the project row's "active" highlight on the worktree header so
  // selecting a worktree visually surfaces it within the parent project.
  // The parent already gets an ambient highlight via ProjectItem when one
  // of its worktree-children is active; this completes the picture by
  // marking the specific worktree too.
  const isActiveSection = useProjectStore((s) => s.activeProjectId === project.id)

  const [showMenu, setShowMenu] = useState(false)
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null)
  const [removeWtOpen, setRemoveWtOpen] = useState(false)
  const [promptsSession, setPromptsSession] = useState<AISession | null>(null)
  const headerRef = useRef<HTMLButtonElement>(null)
  const contextAnchorRef = useRef<HTMLDivElement>(null)
  const { repoRoot } = useWorktrees(removeWtOpen ? parentProject.path : undefined)

  const sessionCount = pairTabsToSessions(sessions, openTabs).visibleCount
  const dirName = project.path.split(/[\\/]/).pop() ?? ''
  const headerLabel = isMainCheckout ? `${parentProject.name} · main` : project.name || dirName
  // For the main checkout, branch comes from `useGitBranch` so "Copy Branch"
  // copies the actual current branch (not the dir name). Worktree-children
  // already encode their branch in `project.name`.
  // For main-checkout sections, prefer the parent-supplied branch (parent
  // already runs a `useGitBranch` for the same path); only subscribe here
  // if no override was provided. Worktree-children encode their branch in
  // `project.name`, so they never need a watcher.
  const ownMainBranch = useGitBranch(
    isMainCheckout && mainBranchOverride === undefined ? project.path : undefined
  )
  const mainBranch = mainBranchOverride !== undefined ? mainBranchOverride : ownMainBranch
  const branchLabel = isMainCheckout ? mainBranch : project.parentRepoName ? project.name : dirName
  // Tooltip shows the worktree directory so the user can still see which
  // checkout this section maps to without crowding the header inline.
  const tooltipDir = isMainCheckout ? parentProject.name : dirName
  const handleFocusTab = (tabId: string, groupId: string): void => {
    setActiveGroup(groupId)
    setActiveTerminalInGroup(groupId, tabId)
  }

  // The mixed-provider flag is computed per-list (Option B avatar rule):
  // if the worktree mixes providers, sessions show their provider corner badge.
  const mixed = isMixedProviderList(sessions)

  return (
    <>
      <button
        ref={headerRef}
        type="button"
        className="dplex-wt-head"
        title={`${headerLabel} · ${tooltipDir} · ${sessionCount} session${sessionCount === 1 ? '' : 's'}`}
        onClick={() => {
          // Selecting a worktree-section sets its project as active (for
          // main-checkout sections that's the parent project itself, which
          // is desirable — clicking the "main" header focuses the project)
          // but only toggles **this section's** collapse state. The parent
          // project's expansion is untouched.
          setActiveProject(project.id)
          toggleWorktreeSection(sectionId)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextPos({ x: e.clientX, y: e.clientY })
          setShowMenu(true)
        }}
      >
        {isExpanded ? (
          <ChevronDown size={11} style={{ color: 'var(--dplex-text-dim)', flex: 'none' }} />
        ) : (
          <ChevronRight size={11} style={{ color: 'var(--dplex-text-dim)', flex: 'none' }} />
        )}
        <GitBranch
          size={11}
          style={{
            color: sessionCount > 0 ? 'var(--dplex-accent)' : 'var(--dplex-text-dim)',
            flex: 'none'
          }}
        />
        {/* Label group flexes to fill the row and truncates with ellipsis.
            Only the branch name shows in the header — the worktree's
            directory is available via the tooltip and the right-click
            "Copy Path" action, so showing it inline was just visual noise
            (most worktrees follow a `<repo>-<branch>` convention which
            duplicates what's already on the row). */}
        <span
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          <span
            className="dplex-wt-branch"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              // Active worktree: shift the branch name to the accent color
              // for a subtle "this is the selected worktree" cue. The
              // parent project row carries the bg highlight; this is just
              // a typographic mark so the two don't compete.
              color: isActiveSection ? 'var(--dplex-accent)' : undefined
            }}
          >
            {headerLabel}
          </span>
        </span>
        {sessionCount > 0 && !isExpanded && (
          // When the section is collapsed the count pill is the only
          // status signal visible, so it stays. When expanded, each
          // session row below carries its own status dot / pill, so
          // showing the aggregate count here is redundant noise.
          <StatusPill visual={visual} compact label={sessionCount} className="flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <ProjectSessionList
          sessions={sessions}
          openTabs={openTabs}
          providers={providers}
          showProviderBadge={mixed}
          // Match the empty-state copy used by no-worktree projects so the
          // visual is consistent: an expanded worktree section with no
          // sessions or open tabs reads "No active sessions." rather than
          // appearing collapsed-but-not-collapsed.
          emptyMessage="No active sessions."
          onFocusTab={handleFocusTab}
          onDeleteSession={deleteSession}
          onShowPrompts={setPromptsSession}
        />
      )}

      {/* Virtual anchor for right-click context menu — positioned at cursor. */}
      {contextPos && (
        <div
          ref={contextAnchorRef}
          aria-hidden
          style={{
            position: 'fixed',
            left: contextPos.x,
            top: contextPos.y,
            width: 1,
            height: 1,
            pointerEvents: 'none'
          }}
        />
      )}

      <PopoverMenu
        anchorRef={contextPos ? contextAnchorRef : headerRef}
        align="left"
        open={showMenu}
        onClose={() => {
          setShowMenu(false)
          setContextPos(null)
        }}
        className="min-w-[180px]"
      >
        {primaryProvider && (
          <button
            key={primaryProvider.id}
            onClick={(e) => {
              e.stopPropagation()
              startAISession(project, primaryProvider.id)
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
            createTerminal(undefined, project.name, undefined, undefined, project.path)
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
        {branchLabel && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              navigator.clipboard.writeText(branchLabel)
              setShowMenu(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            <GitBranch size={11} /> Copy Branch
          </button>
        )}

        {!isMainCheckout && (
          <>
            <div className="my-1" style={{ borderTop: '1px solid var(--dplex-border)' }} />
            <button
              onClick={(e) => {
                e.stopPropagation()
                setRemoveWtOpen(true)
                setShowMenu(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-[var(--dplex-hover)]"
            >
              <Trash2 size={11} /> Remove worktree…
            </button>
          </>
        )}
      </PopoverMenu>

      {removeWtOpen && (
        <RemoveWorktreeProjectModal
          project={project}
          repoRoot={repoRoot}
          onClose={() => setRemoveWtOpen(false)}
          onRemoved={() => setRemoveWtOpen(false)}
        />
      )}

      {promptsSession && (
        <PromptsDialog
          sessionId={promptsSession.id}
          sessionName={promptsSession.displayName}
          providerId={promptsSession.aiTool}
          onClose={() => setPromptsSession(null)}
        />
      )}
    </>
  )
}
