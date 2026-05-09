import { create } from 'zustand'

export type CommandPaletteMode = 'all' | 'commands'

interface CommandPaletteState {
  open: boolean
  mode: CommandPaletteMode
  openWith: (mode: CommandPaletteMode) => void
  toggle: (mode?: CommandPaletteMode) => void
  close: () => void
}

/** Tiny store driving the global command palette modal. Kept separate from
 *  `settingsStore` because the palette is purely transient UI — it should
 *  never be persisted across reloads. */
export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  open: false,
  mode: 'all',
  openWith: (mode) => set({ open: true, mode }),
  toggle: (mode) => {
    const cur = get()
    if (cur.open && (mode === undefined || cur.mode === mode)) {
      set({ open: false })
    } else {
      set({ open: true, mode: mode ?? 'all' })
    }
  },
  close: () => set({ open: false })
}))
