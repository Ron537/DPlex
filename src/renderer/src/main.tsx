import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyCssVarsSync } from './stores/settingsStore'

// Apply cached theme CSS vars synchronously before React renders — prevents flash
const cachedTheme = localStorage.getItem('dplex-theme') || 'midnight'
applyCssVarsSync(cachedTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
