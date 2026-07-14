import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Project, ProviderInfo, WorktreeDefaults } from '../../types'
import { expandPattern } from '../../utils/worktreePath'
import { useProjectStore } from '../../stores/projectStore'
import { useSpaceStore } from '../../stores/spaceStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface NewWorktreeModalProps {
  project: Project
  repoRoot: string
  defaults: WorktreeDefaults
  providers: ProviderInfo[]
  initialBranch?: string
  onClose: () => void
  onCreated: (result: {
    worktreePath: string
    afterCreate: 'session' | 'terminal' | 'none'
    providerId: string | null
    branch: string
    setupScript: string
    /** Space active when the user initiated creation, captured before the
     *  create IPC so a switch during creation can't mis-route the tabs. */
    originSpaceId: string | null
  }) => void
}

export function NewWorktreeModal({
  project,
  repoRoot,
  defaults,
  providers,
  initialBranch,
  onClose,
  onCreated
}: NewWorktreeModalProps): React.JSX.Element {
  const [localBranches, setLocalBranches] = useState<string[]>([])
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [defaultBase, setDefaultBase] = useState<string | null>(null)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [branch, setBranch] = useState(initialBranch ?? '')
  const [baseBranch, setBaseBranch] = useState<string>('')
  const [location, setLocation] = useState<string>('')
  const [locationDirty, setLocationDirty] = useState<boolean>(false)
  const [afterCreate, setAfterCreate] = useState<'session' | 'terminal' | 'none'>(
    defaults.afterCreate
  )
  const [envFiles, setEnvFiles] = useState<string>(defaults.envFiles.join(', '))
  const [setupScript, setSetupScript] = useState<string>(defaults.setupScript)
  const [saveDefaults, setSaveDefaults] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load branches + default base.
  useEffect(() => {
    let cancelled = false
    void window.dplex.worktrees.listBranches(repoRoot).then((result) => {
      if (cancelled) return
      setLocalBranches(result.local)
      setRemoteBranches(result.remote)
      setDefaultBase(result.defaultBase)
      setBaseBranch(result.defaultBase ?? result.local[0] ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [repoRoot])

  // Recompute location when branch changes. Show the configured pattern as a live
  // preview (with a placeholder for branch) before the user types anything. Stop
  // auto-updating once the user has edited the field manually.
  useEffect(() => {
    if (locationDirty) return
    if (branch) {
      setLocation(expandPattern(defaults.locationPattern, project.name, branch))
    } else {
      setLocation(
        defaults.locationPattern
          .replace(/\{project\}/g, project.name)
          .replace(/\{branch\}/g, '<branch>')
      )
    }
  }, [branch, defaults.locationPattern, project.name, locationDirty])

  // Auto-flip to "existing" only when the typed branch matches a known local branch.
  // Never auto-revert based on `mode` itself, so manually clicking "Check out existing"
  // (with a yet-unknown name) is respected.
  useEffect(() => {
    if (!branch) return
    if (localBranches.includes(branch)) setMode('existing')
  }, [branch, localBranches])

  useEscapeKey(onClose)

  const allBranchSuggestions = [
    ...localBranches,
    ...remoteBranches.map((r) => r.replace(/^origin\//, ''))
  ]

  const submit = async (): Promise<void> => {
    const trimmedBranch = branch.trim()
    if (!trimmedBranch || !location.trim()) return
    setSubmitting(true)
    setError(null)
    // Capture the active Space BEFORE the create IPC: worktree creation (git
    // worktree add + optional env copy) can take a moment, and if the user
    // switches Spaces during it, the setup/afterCreate tabs must still route to
    // where the worktree was initiated — not wherever focus happens to be when
    // creation finishes.
    const originSpaceId = useSpaceStore.getState().activeSpaceId
    try {
      const resp = await window.dplex.worktrees.create({
        repoRoot,
        branch: trimmedBranch,
        newBranch: mode === 'new',
        baseBranch: mode === 'new' ? baseBranch || defaultBase : null,
        worktreePath: location.trim(),
        envFiles: envFiles
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        trackInSidecar: true
      })
      if ('code' in resp) {
        setError(resp.message)
        setSubmitting(false)
        return
      }
      if (saveDefaults) {
        const parsedEnvFiles = envFiles
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        useProjectStore.getState().updateProjectWorktreeOverrides(project.id, {
          ...(project.worktreeOverrides ?? {}),
          envFiles: parsedEnvFiles,
          setupScript,
          afterCreate
        })
      }
      onCreated({
        worktreePath: resp.worktree.path,
        afterCreate,
        providerId: null,
        branch: trimmedBranch,
        setupScript,
        originSpaceId
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(10,10,12,0.65)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[85vh] overflow-auto rounded-xl"
        style={{
          backgroundColor: 'var(--dplex-bg-elev)',
          border: '1px solid var(--dplex-border-strong)',
          boxShadow: 'var(--dplex-shadow-xl)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--dplex-border)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--dplex-text)' }}>
            New worktree — {project.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--dplex-hover)] rounded"
            style={{ color: 'var(--dplex-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-[12px]" style={{ color: 'var(--dplex-text)' }}>
          <div className="flex gap-2 text-[11px]">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === 'new'}
                onChange={() => setMode('new')}
              />
              New branch
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
              />
              Check out existing
            </label>
          </div>

          <Field label="Branch">
            <input
              type="text"
              list="dplex-wt-branches"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="feature/auth"
              className="w-full px-2 py-1 rounded"
              style={{
                backgroundColor: 'var(--dplex-bg-alt)',
                border: '1px solid var(--dplex-border)',
                color: 'var(--dplex-text)'
              }}
            />
            <datalist id="dplex-wt-branches">
              {allBranchSuggestions.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </Field>

          {mode === 'new' && (
            <Field label="Base branch">
              <input
                type="text"
                list="dplex-wt-bases"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="w-full px-2 py-1 rounded"
                style={{
                  backgroundColor: 'var(--dplex-bg-alt)',
                  border: '1px solid var(--dplex-border)',
                  color: 'var(--dplex-text)'
                }}
              />
              <datalist id="dplex-wt-bases">
                {localBranches.map((b) => (
                  <option key={b} value={b} />
                ))}
                {remoteBranches.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Field>
          )}

          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                setLocationDirty(true)
              }}
              className="w-full px-2 py-1 rounded font-mono text-[11px]"
              style={{
                backgroundColor: 'var(--dplex-bg-alt)',
                border: '1px solid var(--dplex-border)',
                color: 'var(--dplex-text)'
              }}
            />
          </Field>

          <Field label="After create">
            <div className="flex gap-3 text-[11px]">
              {(['session', 'terminal', 'none'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="after"
                    checked={afterCreate === v}
                    onChange={() => setAfterCreate(v)}
                  />
                  {v === 'session'
                    ? 'Start AI session'
                    : v === 'terminal'
                      ? 'Open terminal'
                      : 'None'}
                </label>
              ))}
            </div>
          </Field>

          {afterCreate === 'session' && providers.length > 0 && (
            <div
              className="text-[10px] px-2 py-1 rounded"
              style={{
                color: 'var(--dplex-text-muted)',
                backgroundColor: 'var(--dplex-bg-alt)'
              }}
            >
              Uses the default AI provider from settings.
            </div>
          )}

          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px]"
            style={{ color: 'var(--dplex-accent)' }}
          >
            {showAdvanced ? '− Advanced' : '+ Advanced'}
          </button>

          {showAdvanced && (
            <>
              <Field label="Setup script">
                <textarea
                  value={setupScript}
                  onChange={(e) => setSetupScript(e.target.value)}
                  rows={3}
                  placeholder="npm install"
                  className="w-full px-2 py-1 rounded font-mono text-[11px]"
                  style={{
                    backgroundColor: 'var(--dplex-bg-alt)',
                    border: '1px solid var(--dplex-border)',
                    color: 'var(--dplex-text)'
                  }}
                />
              </Field>
              <Field label="Env files (comma-separated)">
                <input
                  type="text"
                  value={envFiles}
                  onChange={(e) => setEnvFiles(e.target.value)}
                  className="w-full px-2 py-1 rounded font-mono text-[11px]"
                  style={{
                    backgroundColor: 'var(--dplex-bg-alt)',
                    border: '1px solid var(--dplex-border)',
                    color: 'var(--dplex-text)'
                  }}
                />
              </Field>
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  checked={saveDefaults}
                  onChange={(e) => setSaveDefaults(e.target.checked)}
                />
                Save these as project defaults
              </label>
            </>
          )}

          {error && (
            <div className="text-[11px] text-red-400" role="alert">
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-4 py-3"
          style={{ borderTop: '1px solid var(--dplex-border)' }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 text-[11px] rounded hover:bg-[var(--dplex-hover)]"
            style={{ color: 'var(--dplex-text)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !branch.trim() || !location.trim()}
            className="px-3 py-1 text-[11px] rounded disabled:opacity-40"
            style={{
              backgroundColor: 'var(--dplex-accent)',
              color: 'var(--dplex-accent-fg)'
            }}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <label
        className="block text-[10px] uppercase mb-1"
        style={{ color: 'var(--dplex-text-muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
