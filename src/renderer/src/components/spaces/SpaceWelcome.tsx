import type { JSX } from 'react'
import { FolderPlus, LayoutGrid, Play, Terminal } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useProvidersStore } from '../../stores/providersStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { deriveAvatarColor, getAvatarInitials } from '../../utils/projectStatus'
import { openPlainTerminal, openProjectTerminal, startProjectSession } from '../../utils/spaceStart'
import type { Project, Space } from '../../types'
import { SpaceAvatar } from './SpaceAvatar'
import { boundProjects } from './spaceVisuals'

/**
 * Empty-workspace state shown when the space in focus has no open tabs. Unlike
 * the generic welcome, it surfaces the space's own projects so the developer
 * can start a session or terminal in one click — no detour through the Projects
 * tab. When the space has no projects bound yet, it invites adding one.
 */
export function SpaceWelcome({ space }: { space: Space }): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const providers = useProvidersStore((s) => s.providers)
  const defaultAITool = useSettingsStore((s) => s.settings.defaultAITool)
  const openProjects = useSpacesUiStore((s) => s.openProjects)

  const bound = boundProjects(space, projects)
  const primaryProvider = providers.find((p) => p.id === defaultAITool) ?? providers[0]

  return (
    <div
      className="flex items-center justify-center h-full px-6 overflow-y-auto dplex-scroll-autohide"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 800px 400px at 50% 25%, var(--dplex-accent-faint) 0%, transparent 70%)'
      }}
    >
      <div
        className="flex flex-col items-center gap-6 text-center w-full"
        style={{ maxWidth: 460 }}
      >
        <div className="flex flex-col items-center gap-3">
          <SpaceAvatar space={space} size={56} />
          <div className="flex flex-col gap-1.5">
            <h1
              className="text-[24px] font-semibold tracking-tight"
              style={{ color: 'var(--dplex-text)', letterSpacing: '-0.02em' }}
            >
              {space.name}
            </h1>
            <p
              className="text-[13.5px] leading-relaxed"
              style={{ color: 'var(--dplex-text-muted)' }}
            >
              {bound.length > 0
                ? 'Pick up where you left off — start a session or terminal in one of this space’s projects.'
                : 'This space is empty. Add a project to launch sessions here, or open a terminal.'}
            </p>
          </div>
        </div>

        {bound.length > 0 && (
          <div className="flex flex-col gap-2 w-full">
            {bound.map((project) => (
              <ProjectStartCard
                key={project.id}
                project={project}
                providerLabel={primaryProvider?.name}
                onStartSession={() => startProjectSession(project, primaryProvider?.id)}
                onOpenTerminal={() => openProjectTerminal(project)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center flex-wrap justify-center gap-2">
          <SecondaryAction
            icon={<FolderPlus size={14} />}
            label="Add a project"
            primary={bound.length === 0}
            onClick={() => openProjects(space.id)}
          />
          <SecondaryAction
            icon={<Terminal size={14} />}
            label="Open a terminal"
            onClick={() => openPlainTerminal()}
          />
          <SecondaryAction
            icon={<LayoutGrid size={14} />}
            label="Overview"
            onClick={() => useSpaceStore.getState().sendToBackground()}
          />
        </div>
      </div>
    </div>
  )
}

function ProjectStartCard({
  project,
  providerLabel,
  onStartSession,
  onOpenTerminal
}: {
  project: Project
  providerLabel?: string
  onStartSession: () => void
  onOpenTerminal: () => void
}): JSX.Element {
  const color = deriveAvatarColor(project.tabColor)
  return (
    <div
      className="flex items-center gap-3 rounded-xl transition-colors"
      style={{
        padding: '10px 12px',
        background: 'var(--dplex-bg-elev)',
        border: '1px solid var(--dplex-border)',
        boxShadow: 'var(--dplex-shadow-sm)'
      }}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 700,
          color: color.fg,
          backgroundColor: color.bg,
          border: `1px solid ${color.border}`
        }}
      >
        {getAvatarInitials(project.name)}
      </span>
      <span
        className="flex-1 min-w-0 truncate text-left"
        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--dplex-text)' }}
      >
        {project.name}
      </span>
      <button
        type="button"
        onClick={onStartSession}
        title={providerLabel ? `Start ${providerLabel}` : 'Start AI session'}
        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg transition-colors"
        style={{
          height: 30,
          padding: '0 12px',
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--dplex-accent-fg)',
          background: 'var(--dplex-accent)'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
        onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
      >
        <Play size={12} />
        Start session
      </button>
      <button
        type="button"
        onClick={onOpenTerminal}
        title="Open a terminal in this project"
        className="flex-shrink-0 inline-flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--dplex-hover)]"
        style={{ width: 30, height: 30, color: 'var(--dplex-text-muted)' }}
      >
        <Terminal size={14} />
      </button>
    </div>
  )
}

function SecondaryAction({
  icon,
  label,
  onClick,
  primary
}: {
  icon: JSX.Element
  label: string
  onClick: () => void
  primary?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg transition-colors"
      style={{
        height: 30,
        padding: '0 12px',
        fontSize: 12.5,
        fontWeight: 600,
        color: primary ? 'var(--dplex-accent-fg)' : 'var(--dplex-text-2)',
        background: primary ? 'var(--dplex-accent)' : 'var(--dplex-bg-elev)',
        border: primary ? '1px solid transparent' : '1px solid var(--dplex-border)'
      }}
      onMouseEnter={(e) => {
        if (primary) e.currentTarget.style.filter = 'brightness(1.08)'
        else e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev-2)'
      }}
      onMouseLeave={(e) => {
        if (primary) e.currentTarget.style.filter = 'none'
        else e.currentTarget.style.backgroundColor = 'var(--dplex-bg-elev)'
      }}
    >
      <span style={{ color: primary ? 'var(--dplex-accent-fg)' : 'var(--dplex-text-dim)' }}>
        {icon}
      </span>
      {label}
    </button>
  )
}
