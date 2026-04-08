import { Terminal, FolderOpen, Cpu } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'

export function StatusBar(): JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeTab = useTerminalStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-[#16162a] border-t border-[#2a2a4a] text-[10px] text-zinc-500 select-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <FolderOpen size={10} />
          ~
        </span>
        <span className="flex items-center gap-1">
          <Cpu size={10} />
          Copilot CLI
        </span>
      </div>
      <div className="flex items-center gap-3">
        {activeTab && (
          <span className="flex items-center gap-1">
            <Terminal size={10} />
            {activeTab.title}
          </span>
        )}
        <span>{tabs.length} tab{tabs.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}
