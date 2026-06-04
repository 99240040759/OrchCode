import { globalStyle } from '@vanilla-extract/css'

// ─── App Root Layout ──────────────────────────────────────────────────────────

globalStyle('.app-root', {
  display: 'flex',
  height: '100vh',
  overflow: 'hidden',
  position: 'relative',
  width: '100%'
})

globalStyle('.app-content-wrapper', {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100vh',
  minWidth: 0,
  flex: 1
})

// ─── Main Window & Split-View Layout ─────────────────────────────────────────

globalStyle('.app-container', {
  display: 'flex',
  height: '100vh',
  width: '100vw',
  position: 'relative'
})

globalStyle('.workspace-main', {
  display: 'flex',
  flex: 1,
  minWidth: 0,
  position: 'relative',
  overflow: 'hidden',
  height: '100%'
})

globalStyle('.app-glow-border', {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  border: '1px solid var(--border-color)',
  borderLeft: 'none',
  pointerEvents: 'none',
  zIndex: 999
})

// Single definition — was duplicated before
globalStyle('.split-view-container', {
  display: 'flex',
  width: '100%',
  height: '100%',
  overflow: 'hidden'
})

globalStyle('.panel-resize-handle', {
  width: '1px',
  background: 'linear-gradient(to bottom, var(--bg-sidebar) 40px, var(--border-color) 40px)',
  cursor: 'col-resize',
  position: 'relative',
  transition: 'background-color 0.15s ease',
  zIndex: 10
})

globalStyle('.panel-resize-handle::before', {
  content: '""',
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: '-4px',
  right: '-4px',
  backgroundColor: 'transparent'
})

globalStyle('.panel-resize-handle:hover, .panel-resize-handle[data-resize-handle-active]', {
  backgroundColor: 'var(--border-focus)'
})

// ─── Thread Loading Overlay ───────────────────────────────────────────────────
// Used by ChatPane for the thread switch skeleton

globalStyle('.thread-loading-overlay', {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(18, 18, 18, 0.6)',
  zIndex: 50
})

globalStyle('.thread-loading-spinner', {
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  border: '2px solid rgba(255,255,255,0.1)',
  borderTopColor: 'var(--accent-blue)',
  animation: 'spin 0.7s linear infinite'
})
