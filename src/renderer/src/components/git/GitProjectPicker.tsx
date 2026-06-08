import { ProjectPicker } from '../common/ProjectPicker'

/**
 * Header dropdown for the Source Control side panel. Thin wrapper over the
 * shared {@link ProjectPicker}; preserves the `git-project-picker-*` test ids.
 */
export function GitProjectPicker(): React.JSX.Element | null {
  return <ProjectPicker testIdPrefix="git-project-picker" />
}
