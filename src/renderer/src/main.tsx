import { init as initSentry } from '@sentry/electron/renderer'

window.addEventListener('beforeunload', () => {
  // No worker to terminate — telemetry worker removed
})

initSentry()

// Google Fonts (must stay as CSS — no VE equivalent for @import url)
import './assets/main.css'
// Vanilla-extract global styles
import './assets/styles'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
