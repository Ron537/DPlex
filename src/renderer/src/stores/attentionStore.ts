import { create } from 'zustand'
import type { AttentionEvent, AttentionSnapshot } from '../../../preload/attentionTypes'

interface AttentionState {
  version: number
  active: AttentionEvent[]
  unreadCount: number
  loaded: boolean
  init: () => () => void
  acknowledge: (compositeId: string) => void
  acknowledgeAll: () => void
  dismiss: (compositeId: string) => void
}

function applySnapshot(snapshot: AttentionSnapshot): Partial<AttentionState> {
  return {
    version: snapshot.version,
    active: snapshot.active,
    unreadCount: snapshot.unreadCount,
    loaded: true
  }
}

export const useAttentionStore = create<AttentionState>((set) => ({
  version: 0,
  active: [],
  unreadCount: 0,
  loaded: false,

  init: () => {
    // Hydrate from main, then subscribe to updates.
    window.dplex.attention.getSnapshot().then((snap) => {
      set(applySnapshot(snap))
    })
    const unsubscribe = window.dplex.attention.onUpdated((snap) => {
      set(applySnapshot(snap))
    })
    return unsubscribe
  },

  acknowledge: (compositeId) => {
    window.dplex.attention.acknowledge(compositeId)
  },
  acknowledgeAll: () => {
    window.dplex.attention.acknowledgeAll()
  },
  dismiss: (compositeId) => {
    window.dplex.attention.dismiss(compositeId)
  }
}))
