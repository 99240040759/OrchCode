import { init as initSentry } from '@sentry/electron/renderer'
import { getSharedWorker } from './lib/workerManager'

// Initialize Sentry Renderer SDK (inherits DSN and enabled settings from Main)
initSentry()

// Initialize background telemetry client ID
let clientId = localStorage.getItem('orchcode_client_id')
if (!clientId) {
  clientId = self.crypto.randomUUID()
  localStorage.setItem('orchcode_client_id', clientId)
}

// Bootstrap consolidated worker off-thread telemetry
try {
  const workerApi = getSharedWorker()
  if (workerApi) {
    workerApi.sendTelemetryEvent('app_launch', { 
      platform: navigator.userAgent.includes('Mac') ? 'macos' : 'windows' 
    })
  }
} catch (err) {
  console.error('[main] Telemetry bootstrap failed:', err)
}

import './assets/main.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
