import { init as initSentry } from '@sentry/electron/renderer'
import { getSharedWorker, terminateSharedWorker } from './lib/workerManager'

window.addEventListener('beforeunload', () => {
  terminateSharedWorker()
})

initSentry()

let clientId = localStorage.getItem('orchcode_client_id')
if (!clientId) {
  clientId = self.crypto.randomUUID()
  localStorage.setItem('orchcode_client_id', clientId)
}

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
