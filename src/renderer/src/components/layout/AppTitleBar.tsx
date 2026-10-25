import { Search } from 'lucide-react'
import { useCommandPaletteStore } from '../../stores/commandPaletteStore'
import { MOD, isMac } from '../../utils/shortcuts'
import { AttentionBellButton } from '../attention/AttentionBellButton'
import { DPlexLogo } from '../common/DPlexLogo'
import { ProjectFocusControl } from './ProjectFocusControl'

export function AppTitleBar(): React.JSX.Element {
  return (
    <header className="dplex-titlebar drag-region" style={{ paddingLeft: isMac ? 88 : 18 }}>
      <div className="dplex-brand select-none">
        <DPlexLogo size={26} flat />
        <div>
          <span className="dplex-brand-name">DPlex</span>
          <span className="dplex-brand-caption">Agent workspace</span>
        </div>
      </div>
      <button
        type="button"
        className="dplex-command-trigger no-drag hover:bg-[var(--dplex-hover)]"
        data-testid="titlebar-search"
        aria-label="Search your workspace"
        onClick={() => useCommandPaletteStore.getState().openWith('all')}
      >
        <Search size={14} />
        <span>Search your workspace...</span>
        <kbd>{MOD}P</kbd>
      </button>
      <div className="dplex-titlebar-actions no-drag">
        <ProjectFocusControl />
        <span className="dplex-chrome-divider" aria-hidden />
        <AttentionBellButton />
      </div>
    </header>
  )
}
