import { create } from 'zustand'

export interface ProviderInfo {
  id: string
  name: string
  command: string
  icon?: string
}

interface ProvidersState {
  providers: ProviderInfo[]
  loaded: boolean
  load: () => Promise<void>
  /** Human-readable label for a provider id. Falls back to the id itself. */
  getLabel: (id: string) => string
  /** CLI command string for a provider id. Falls back to the id itself. */
  getCommand: (id: string) => string
}

/**
 * Renderer-side cache of the provider registry (loaded once at app startup).
 *
 * Centralizes provider-id → label/command lookups so no non-provider-specific
 * code has to hard-code provider ids like `'copilot-cli'`. Adding a new
 * provider only requires registering it in the main-process registry; all
 * UI labels and commands pick it up automatically.
 */
export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,

  load: async () => {
    try {
      const list = await window.dplex.sessions.getProviders()
      set({ providers: list ?? [], loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  getLabel: (id) => get().providers.find((p) => p.id === id)?.name ?? id,
  getCommand: (id) => get().providers.find((p) => p.id === id)?.command ?? id
}))
