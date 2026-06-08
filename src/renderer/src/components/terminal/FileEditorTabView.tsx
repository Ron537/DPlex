import React from 'react'
import { Save } from 'lucide-react'
import type { FileEditorTab } from '../../types'
import { useSettingsStore } from '../../stores/settingsStore'
import { getFileEditorHandle } from '../../services/fileEditorRegistry'
import { MonacoEditorPane } from './MonacoEditorPane'

interface FileEditorTabViewProps {
  tab: FileEditorTab
  isActive: boolean
}

/**
 * Per-file editable tab. Thin header (path + save state) over the
 * `MonacoEditorPane`, which owns the editor lifecycle, dirty tracking, and
 * save protocol. The header's Save button is only relevant in manual mode;
 * in onChange mode saves happen automatically.
 */
export function FileEditorTabView({ tab, isActive }: FileEditorTabViewProps): React.JSX.Element {
  const autoSaveMode = useSettingsStore((s) => s.settings.editorAutoSave)
  const isDirty = tab.dirty === true

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--dplex-bg)' }}>
      <div
        className="flex items-center gap-2 px-3 h-8 text-[11px] flex-shrink-0"
        style={{ color: 'var(--dplex-text-muted)', borderBottom: '1px solid var(--dplex-border)' }}
      >
        <span className="truncate" title={tab.relPath}>
          {tab.rootLabel} · {tab.relPath}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--dplex-text-dim)' }}>
            {autoSaveMode === 'onChange' ? 'Auto-save' : 'Manual save'}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--dplex-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => void getFileEditorHandle(tab.id)?.save()}
            disabled={!isDirty}
            title={isDirty ? 'Save (Cmd/Ctrl+S)' : 'No unsaved changes'}
          >
            <Save size={12} />
            <span>Save{isDirty ? ' •' : ''}</span>
          </button>
        </div>
      </div>
      <div className="flex-1 min-w-0 min-h-0">
        <MonacoEditorPane
          tabId={tab.id}
          rootFs={tab.rootFs}
          relPath={tab.relPath}
          isActive={isActive}
        />
      </div>
    </div>
  )
}
