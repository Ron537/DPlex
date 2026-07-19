import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyCssVarsSync, useSettingsStore } from './stores/settingsStore'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useTerminalStore } from './stores/terminalStore'
import { useSpaceStore } from './stores/spaceStore'
import { useDashboardStore } from './stores/dashboardStore'
import { useAttentionStore } from './stores/attentionStore'
import * as terminalRegistry from './services/terminalRegistry'

// Apply cached theme CSS vars synchronously before React renders — prevents flash
const cachedTheme = localStorage.getItem('dplex-theme') || 'dplex'
applyCssVarsSync(cachedTheme)

// Demo-mode hatch — exposes Zustand stores on window for screenshot/demo
// scripts. Gated behind `localStorage["dplex-demo"] === "1"` so it's a no-op
// in normal use. Safe to leave in production: only consumers that explicitly
// opt in via localStorage can see the stores.
if (typeof window !== 'undefined' && localStorage.getItem('dplex-demo') === '1') {
  ;(window as unknown as { __dplex: unknown }).__dplex = {
    settingsStore: useSettingsStore,
    projectStore: useProjectStore,
    sessionStore: useSessionStore,
    terminalStore: useTerminalStore,
    spaceStore: useSpaceStore,
    dashboardStore: useDashboardStore,
    attentionStore: useAttentionStore,
    terminalRegistry,
    applyCssVarsSync
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
