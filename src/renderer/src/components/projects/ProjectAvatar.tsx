import { memo } from 'react'
import { getAvatarColor, getAvatarInitials } from '../../utils/projectStatus'

interface ProjectAvatarProps {
  /** Stable id used to derive the deterministic avatar color. */
  projectId: string
  /** Project name used to derive the 1-2 letter glyph. */
  name: string
  /** Square size in px. Defaults to 22 — the size used in the command palette. */
  size?: number
}

/**
 * Small square project avatar — deterministic color + initials glyph derived
 * from the project's id/name. Used in surfaces that aren't `ProjectItem`
 * (e.g. the command palette) so they share the same visual identity as the
 * sidebar without duplicating the styling logic.
 */
export const ProjectAvatar = memo(function ProjectAvatar({
  projectId,
  name,
  size = 22
}: ProjectAvatarProps): React.JSX.Element {
  const color = getAvatarColor(projectId)
  const initials = getAvatarInitials(name)
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-md font-bold leading-none"
      style={{
        width: size,
        height: size,
        backgroundColor: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        flexShrink: 0
      }}
    >
      {initials}
    </span>
  )
})
