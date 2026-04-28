import { useState } from 'react'
import { X } from 'lucide-react'
import type { Project, ProjectWorktreeOverrides } from '../../types'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface ProjectWorktreeDefaultsModalProps {
  project: Project
  onClose: () => void
}

export function ProjectWorktreeDefaultsModal({
  project,
  onClose
}: ProjectWorktreeDefaultsModalProps): React.JSX.Element {
  const globalDefaults = useSettingsStore((s) => s.settings.worktreeDefaults)
  const updateOverrides = useProjectStore((s) => s.updateProjectWorktreeOverrides)

  const existing = project.worktreeOverrides ?? {}
  const [locationPattern, setLocationPattern] = useState<string | undefined>(
    existing.locationPattern
  )
  const [envFiles, setEnvFiles] = useState<string | undefined>(
    existing.envFiles == null ? undefined : existing.envFiles.join(', ')
  )
  const [setupScript, setSetupScript] = useState<string | undefined>(existing.setupScript)
  const [afterCreate, setAfterCreate] = useState<'session' | 'terminal' | 'none' | undefined>(
    existing.afterCreate
  )
  useEscapeKey(onClose)

  const save = (): void => {
    const overrides: ProjectWorktreeOverrides = {}
    if (locationPattern !== undefined) overrides.locationPattern = locationPattern
    if (envFiles !== undefined) {
      overrides.envFiles = envFiles
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    if (setupScript !== undefined) overrides.setupScript = setupScript
    if (afterCreate !== undefined) overrides.afterCreate = afterCreate
    const isEmpty = Object.keys(overrides).length === 0
    updateOverrides(project.id, isEmpty ? null : overrides)
    onClose()
  }

  const reset = (): void => {
    updateOverrides(project.id, null)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[85vh] overflow-auto rounded-lg shadow-2xl"
        style={{ backgroundColor: 'var(--dplex-bg)', border: '1px solid var(--dplex-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--dplex-text)' }}>
            Worktree defaults — {project.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4 text-[12px]" style={{ color: 'var(--dplex-text)' }}>
          <p className="text-[11px]" style={{ color: 'var(--dplex-text-muted)' }}>
            Leave a field unchecked to inherit the global default.
          </p>

          <OverrideField
            label="Location pattern"
            globalValue={globalDefaults.locationPattern}
            value={locationPattern}
            onChange={setLocationPattern}
            render={(value, setValue) => (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-2 py-1 rounded font-mono text-[11px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text)'
                }}
              />
            )}
            defaultOverrideValue={globalDefaults.locationPattern}
          />

          <OverrideField
            label="Env files"
            globalValue={globalDefaults.envFiles.join(', ')}
            value={envFiles}
            onChange={setEnvFiles}
            render={(value, setValue) => (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full px-2 py-1 rounded font-mono text-[11px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text)'
                }}
              />
            )}
            defaultOverrideValue={globalDefaults.envFiles.join(', ')}
          />

          <OverrideField
            label="Setup script"
            globalValue={globalDefaults.setupScript || '(none)'}
            value={setupScript}
            onChange={setSetupScript}
            render={(value, setValue) => (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
                className="w-full px-2 py-1 rounded font-mono text-[11px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text)'
                }}
              />
            )}
            defaultOverrideValue={globalDefaults.setupScript}
          />

          <OverrideField
            label="After creation"
            globalValue={globalDefaults.afterCreate}
            value={afterCreate}
            onChange={setAfterCreate}
            render={(value, setValue) => (
              <select
                value={value}
                onChange={(e) => setValue(e.target.value as 'session' | 'terminal' | 'none')}
                className="w-full px-2 py-1 rounded text-[11px]"
                style={{
                  backgroundColor: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text)'
                }}
              >
                <option value="session">Start AI session</option>
                <option value="terminal">Open terminal</option>
                <option value="none">Do nothing</option>
              </select>
            )}
            defaultOverrideValue={globalDefaults.afterCreate}
          />
        </div>

        <div
          className="flex items-center justify-between gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--dplex-border)' }}
        >
          <button
            onClick={reset}
            className="px-3 py-1 text-[11px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            Reset to global defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-[11px] rounded hover:bg-[var(--dplex-hover)]"
              style={{ color: 'var(--dplex-text)' }}
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="px-3 py-1 text-[11px] rounded"
              style={{ backgroundColor: 'var(--dplex-accent)', color: 'white' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface OverrideFieldProps<T> {
  label: string
  globalValue: string
  value: T | undefined
  onChange: (v: T | undefined) => void
  render: (value: T, setValue: (v: T) => void) => React.ReactNode
  defaultOverrideValue?: T
}

function OverrideField<T>({
  label,
  globalValue,
  value,
  onChange,
  render,
  defaultOverrideValue
}: OverrideFieldProps<T>): React.JSX.Element {
  const overridden = value !== undefined
  return (
    <div>
      <label
        className="flex items-center gap-2 text-[10px] uppercase mb-1"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        <input
          type="checkbox"
          checked={overridden}
          onChange={(e) => {
            if (e.target.checked) {
              onChange(defaultOverrideValue ?? ('' as unknown as T))
            } else {
              onChange(undefined)
            }
          }}
        />
        {label}
        {!overridden && (
          <span className="normal-case ml-1" style={{ color: 'var(--dplex-text-muted)' }}>
            inheriting: <span className="font-mono">{globalValue || '(empty)'}</span>
          </span>
        )}
      </label>
      {overridden && render(value as T, (v) => onChange(v))}
    </div>
  )
}
