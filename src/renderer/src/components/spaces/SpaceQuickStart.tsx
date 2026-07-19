import { useRef, useState, type JSX } from 'react'
import { FolderPlus, Play, Plus, Terminal } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useProvidersStore } from '../../stores/providersStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSpacesUiStore } from '../../stores/spacesUiStore'
import { deriveAvatarColor, getAvatarInitials } from '../../utils/projectStatus'
import { openPlainTerminal, openProjectTerminal, startProjectSession } from '../../utils/spaceStart'
import type { Project, Space } from '../../types'
import { PopoverMenu } from '../common/PopoverMenu'
import { boundProjects } from './spaceVisuals'

/**
 * "New session" quick-start for the space in focus. Lets the user launch an AI
 * session or a terminal for any of the space's bound projects without leaving
 * for the Projects tab — the whole point of a space is that its projects are
 * already at hand. Falls back to "add a project" / "plain terminal" when the
 * space has no projects bound yet.
 */
export function SpaceQuickStart({ space }: { space: Space }): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const projects = useProjectStore((s) => s.projects)
  const providers = useProvidersStore((s) => s.providers)
  const defaultAITool = useSettingsStore((s) => s.settings.defaultAITool)
  const openProjects = useSpacesUiStore((s) => s.openProjects)

  const bound = boundProjects(space, projects)
  const primaryProvider = providers.find((p) => p.id === defaultAITool) ?? providers[0]

  const close = (): void => setOpen(false)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="space-quick-start"
        title="Start a session or terminal in this space"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-[var(--dplex-accent-soft)]"
        style={{
          height: 26,
          padding: '0 10px',
          color: 'var(--dplex-accent)',
          fontSize: 12,
          fontWeight: 600
        }}
      >
        <Plus size={14} />
        New session
      </button>

      <PopoverMenu anchorRef={anchorRef} open={open} onClose={close} align="right">
        <div style={{ width: 288, padding: 7 }}>
          <div
            style={{
              padding: '4px 8px 8px',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: 'var(--dplex-text-faint)'
            }}
          >
            Start in {space.name}
          </div>

          {bound.length > 0 ? (
            <div className="max-h-[280px] overflow-y-auto dplex-scroll-autohide">
              {bound.map((project) => (
                <ProjectQuickRow
                  key={project.id}
                  project={project}
                  providerLabel={primaryProvider?.name}
                  onStartSession={() => {
                    close()
                    startProjectSession(project, primaryProvider?.id)
                  }}
                  onOpenTerminal={() => {
                    close()
                    openProjectTerminal(project)
                  }}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '2px 8px 10px',
                fontSize: 11.5,
                lineHeight: 1.5,
                color: 'var(--dplex-text-dim)'
              }}
            >
              No projects in this space yet. Add one to start sessions here.
            </div>
          )}

          <div
            style={{ height: 1, margin: '5px 4px', backgroundColor: 'var(--dplex-border-subtle)' }}
          />

          <MenuAction
            icon={<FolderPlus size={14} />}
            label={bound.length > 0 ? 'Add a project…' : 'Add a project'}
            onClick={() => {
              close()
              openProjects(space.id)
            }}
          />
          <MenuAction
            icon={<Terminal size={14} />}
            label="Plain terminal"
            onClick={() => {
              close()
              openPlainTerminal()
            }}
          />
        </div>
      </PopoverMenu>
    </>
  )
}

function ProjectQuickRow({
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
      className="group flex items-center gap-2.5"
      style={{ padding: '6px 8px', borderRadius: 8 }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--dplex-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <span
        className="flex-shrink-0 inline-flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 700,
          color: color.fg,
          backgroundColor: color.bg,
          border: `1px solid ${color.border}`
        }}
      >
        {getAvatarInitials(project.name)}
      </span>
      <span
        className="flex-1 min-w-0 truncate"
        style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--dplex-text)' }}
      >
        {project.name}
      </span>
      <button
        type="button"
        data-testid={`space-quickstart-start-${project.id}`}
        onClick={onStartSession}
        title={providerLabel ? `Start ${providerLabel}` : 'Start AI session'}
        className="flex-shrink-0 inline-flex items-center gap-1 rounded-md transition-colors hover:bg-[var(--dplex-accent-soft)]"
        style={{ padding: '3px 7px', fontSize: 11, fontWeight: 600, color: 'var(--dplex-accent)' }}
      >
        <Play size={11} />
        Start
      </button>
      <button
        type="button"
        onClick={onOpenTerminal}
        title="Open a terminal in this project"
        className="flex-shrink-0 inline-flex items-center justify-center rounded-md transition-colors hover:bg-[var(--dplex-hover)]"
        style={{ width: 24, height: 24, color: 'var(--dplex-text-muted)' }}
      >
        <Terminal size={13} />
      </button>
    </div>
  )
}

function MenuAction({
  icon,
  label,
  onClick
}: {
  icon: JSX.Element
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 transition-colors hover:bg-[var(--dplex-hover)]"
      style={{
        padding: '7px 8px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--dplex-text-2)'
      }}
    >
      <span style={{ color: 'var(--dplex-text-dim)' }}>{icon}</span>
      {label}
    </button>
  )
}
