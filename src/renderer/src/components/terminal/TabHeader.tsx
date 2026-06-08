import { type JSX } from 'react'
import { GitBranch, Folder } from 'lucide-react'
import type { EditorTab } from '../../types'
import { isFileDiffTab, isFileEditorTab, isTerminalTab } from '../../types'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProvidersStore } from '../../stores/providersStore'
import { getTabIdentity } from '../../utils/tabProject'
import { ProjectAvatar } from '../projects/ProjectAvatar'
import { ProviderGlyph } from '../common/ProviderGlyph'
import { StatusPill } from '../common/StatusPill'
import { effectiveSessionVisual } from '../../utils/sessionPairing'
import type { ProviderId } from '../../utils/providerHelpers'

interface TabHeaderProps {
  tab: EditorTab
}

/**
 * Per-pane breadcrumb header that sits **between** the tab bar and the
 * pane's content. Carries the heavy "where am I?" information for the
 * currently active tab so the tabs themselves can stay visually quiet:
 *
 *   [avatar]  ProjectName  …truncated/path/to/cwd  ⌥ branch     [provider]  status
 *
 * Surfaces project identity, cwd, branch (worktree or session), and AI
 * session info when the tab represents a live session. For file-diff
 * tabs the repo-relative path takes the place of session info.
 *
 * Renders nothing when the tab has neither a project match nor any
 * meaningful metadata (e.g. a brand-new shell tab in `~`).
 */
export function TabHeader({ tab }: TabHeaderProps): JSX.Element | null {
  const projects = useProjectStore((s) => s.projects)
  const sessions = useSessionStore((s) => s.sessions)
  const getProviderLabel = useProvidersStore((s) => s.getLabel)

  const identity = getTabIdentity(tab, projects)
  const isTerminal = isTerminalTab(tab)
  const isFileDiff = isFileDiffTab(tab)
  const isFileEditor = isFileEditorTab(tab)

  const session =
    isTerminal && tab.sessionId && tab.providerId
      ? sessions.find((s) => s.id === tab.sessionId && s.aiTool === tab.providerId)
      : undefined

  const displayPath = isFileDiff
    ? tab.repoRootFs
    : isFileEditor
      ? tab.rootFs
      : (tab.worktreePath ?? tab.cwd)
  const branch = (isTerminal ? tab.worktreeBranch : undefined) ?? session?.branch
  const fileDiffPath = isFileDiff ? tab.file.gitPath : isFileEditor ? tab.relPath : undefined

  if (!identity && !displayPath && !session) return null

  const visual = session ? effectiveSessionVisual(session) : undefined
  const providerLabel = session ? getProviderLabel(session.aiTool) : undefined

  return (
    <div
      className="flex items-center gap-2 px-3 select-none flex-shrink-0"
      style={{
        height: 30,
        backgroundColor: 'var(--dplex-bg-alt)',
        borderBottom: '1px solid var(--dplex-border-subtle)',
        fontSize: 12,
        color: 'var(--dplex-text-muted)'
      }}
    >
      {identity ? (
        <ProjectAvatar
          projectId={identity.colorProject.id}
          name={identity.colorProject.name}
          size={18}
        />
      ) : (
        <Folder size={14} style={{ color: 'var(--dplex-text-dim)' }} />
      )}

      {identity && (
        <span
          className="flex-shrink-0"
          style={{ color: 'var(--dplex-text)', fontWeight: 500 }}
          title={identity.matched.path}
        >
          {identity.matched.name}
        </span>
      )}

      {/* Worktree branch shown adjacent to the project name when the
          matched project is a worktree — keeps "DPlex / feature-x"
          context together. */}
      {identity?.matched.parentProjectId && (
        <span style={{ color: 'var(--dplex-text-dim)' }}>·</span>
      )}

      {displayPath && (
        <span
          className="truncate min-w-0"
          // RTL trick keeps the meaningful trailing segments visible
          // ("…/src/main") instead of trimming the right side off.
          style={{ direction: 'rtl', textAlign: 'left', unicodeBidi: 'plaintext' }}
          title={displayPath}
        >
          {displayPath}
        </span>
      )}

      {fileDiffPath && (
        <>
          <span style={{ color: 'var(--dplex-text-dim)' }}>›</span>
          <span className="truncate" title={fileDiffPath}>
            {fileDiffPath}
          </span>
        </>
      )}

      {branch && (
        <span className="inline-flex items-center gap-1 flex-shrink-0" title={`Branch: ${branch}`}>
          <GitBranch size={11} />
          {branch}
        </span>
      )}

      {/* Spacer pushes session info to the right. */}
      <div className="flex-1" />

      {session && visual && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <ProviderGlyph
            providerId={session.aiTool as ProviderId}
            size="xs"
            title={providerLabel}
          />
          {session.status === 'active' && <StatusPill visual={visual} compact />}
        </div>
      )}
    </div>
  )
}
