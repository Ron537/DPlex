import { ElectronAPI } from '@electron-toolkit/preload'
import type { DplexAPI } from './index'

export type { AttentionKind, AttentionEvent, AttentionSnapshot } from './attentionTypes'

declare global {
  interface Window {
    electron: ElectronAPI
    dplex: DplexAPI
  }
}
