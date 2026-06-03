import { globalStyle } from '@vanilla-extract/css'

// ─── Main Window & Split-View Layout ─────────────────────────────────────────

globalStyle('.app-container', {
  display: 'flex',
  height: 'calc(100vh - var(--titlebar-height))',
  width: '100vw',
  position: 'relative'
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

globalStyle('.split-view-container', {
  display: 'flex',
  width: '100%',
  height: '100%',
  overflow: 'hidden'
})

globalStyle('.chat-pane', {
  flex: 1,
  minWidth: '300px',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  backgroundColor: 'var(--bg-app)'
})

globalStyle('.artifact-pane', {
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--bg-app)',
  borderLeft: 'none',
  display: 'flex',
  flexDirection: 'column',
  contain: 'layout paint'
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

globalStyle('.sidebar-collapsed-rail', {
  width: '40px',
  flexShrink: 0,
  height: '100vh',
  backgroundColor: 'var(--bg-sidebar)',
  borderRight: '1px solid var(--border-color)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 'calc(var(--titlebar-height) + 12px)',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease',
  userSelect: 'none'
})

globalStyle('.sidebar-collapsed-rail:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.04)'
})
