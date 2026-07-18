import './assets/main.css'
import * as Sentry from '@sentry/electron/renderer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from 'sonner'
if (import.meta.env.PROD) {
  const dsn = import.meta.env.SENTRY_DSN
  if (dsn && typeof dsn === 'string' && dsn.startsWith('https://')) Sentry.init({ dsn })
  else console.warn('[OrchCode] SENTRY_DSN is missing or invalid. Sentry will not be initialized.')
}
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('[OrchCode] Root element #root not found in document. Check index.html.')
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary fallback={({ error, reset }) => (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-oc-base p-6 text-tx-main font-sans">
        <div className="text-destructive font-semibold mb-4 text-lg">Something went wrong</div>
        <p className="text-tx-sub text-sm mb-6 max-w-md text-center">{error.message}</p>
        <button onClick={reset} className="px-4 py-2 bg-oc-active text-tx-bright rounded-lg text-sm font-semibold hover:opacity-90 border-none cursor-pointer outline-none">Try Again</button>
      </div>
    )}>
      <App />
    </ErrorBoundary>
    <Toaster richColors theme="dark" closeButton />
  </StrictMode>
)
