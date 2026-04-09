import { Terminal, FolderOpen, Cpu } from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'

export function StatusBar(): JSX.Element {
  const groups = useTerminalStore((s) => s.groups)
  const activeGroupId = useTerminalStore((s) => s.activeGroupId)
  const activeGroup = groups.find((g) => g.id === activeGroupId)
  const activeTab = activeGroup?.tabs.find((t) => t.id === activeGroup.activeTabId)
  const totalTerminals = groups.reduce((sum, g) => sum + g.tabs.length, 0)

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
        <span>{totalTerminals} terminal{totalTerminals !== 1 ? 's' : ''} · {groups.length} group{groups.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}
