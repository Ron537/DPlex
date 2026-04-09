import { ElectronAPI } from '@electron-toolkit/preload'
import type { DplexAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    dplex: DplexAPI
  }
}
