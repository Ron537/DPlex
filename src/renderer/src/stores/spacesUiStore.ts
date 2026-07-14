import { create } from 'zustand'

export type SpaceModalMode = 'create' | 'rename' | 'projects'

export interface SpaceModalRequest {
  mode: SpaceModalMode
  /** Present for 'rename' / 'projects' — the space being edited. */
  spaceId?: string
}

export interface SpaceDeleteRequest {
  id: string
  name: string
}

interface SpacesUiState {
  modal: SpaceModalRequest | null
  deleteRequest: SpaceDeleteRequest | null
  openCreate: () => void
  openRename: (spaceId: string) => void
  /** Opens the same editor focused on binding projects (heading reflects the
   *  intent so an "Add a project" affordance never reads "Rename space"). */
  openProjects: (spaceId: string) => void
  closeModal: () => void
  requestDelete: (space: SpaceDeleteRequest) => void
  cancelDelete: () => void
}

/**
 * Cross-surface UI coordination for Spaces. Any surface (switcher dropdown,
 * sidebar panel, overview) can request the create/rename modal or a delete
 * confirmation; single instances mounted at the app root render them.
 */
export const useSpacesUiStore = create<SpacesUiState>((set) => ({
  modal: null,
  deleteRequest: null,
  openCreate: () => set({ modal: { mode: 'create' } }),
  openRename: (spaceId) => set({ modal: { mode: 'rename', spaceId } }),
  openProjects: (spaceId) => set({ modal: { mode: 'projects', spaceId } }),
  closeModal: () => set({ modal: null }),
  requestDelete: (space) => set({ deleteRequest: space }),
  cancelDelete: () => set({ deleteRequest: null })
}))
