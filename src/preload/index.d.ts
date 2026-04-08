import { ElectronAPI } from '@electron-toolkit/preload'
import type { TplexAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    tplex: TplexAPI
  }
}
