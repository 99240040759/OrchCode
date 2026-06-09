import { init as initSentry } from '@sentry/electron/renderer'
initSentry()

// --- Native Desktop Refinements ---
// 1. Prevent zoom shortcut keys and pinch-to-zoom gestures
document.addEventListener('keydown', (e) => {
  if (
    e.ctrlKey &&
    (e.key === '=' ||
      e.key === '-' ||
      e.key === '0' ||
      e.key === '+' ||
      e.code === 'Equal' ||
      e.code === 'Minus' ||
      e.code === 'Digit0')
  ) {
    e.preventDefault()
  }
})

document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault()
  }
}, { passive: false })

// 2. Restrict right-click context menu to editable elements and editor views only
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement
  const isEditable =
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') ||
    target.closest('.monaco-editor')
  if (!isEditable) {
    e.preventDefault()
  }
})

// Google Fonts (must stay as CSS — no VE equivalent for @import url)
import './assets/main.css'
import 'katex/dist/katex.min.css'
import './assets/styles'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './lib/uiUtils'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
