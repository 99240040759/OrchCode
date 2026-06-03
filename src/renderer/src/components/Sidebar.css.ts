import { globalStyle } from '@vanilla-extract/css'

// ─── Sidebar ──────────────────────────────────────────────────────────────────

globalStyle('.sidebar', {
  backgroundColor: 'var(--bg-sidebar)',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  contain: 'layout paint'
})

globalStyle('.sidebar.expanded', {
  width: 'var(--sidebar-width-expanded)'
})

globalStyle('.sidebar-divider', {
  height: '1px',
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  width: '100%'
})

globalStyle('.sidebar-body', {
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column'
})
globalStyle('.sidebar-body::-webkit-scrollbar', { width: '4px' })
globalStyle('.sidebar-body::-webkit-scrollbar-thumb', {
  background: 'rgba(255, 255, 255, 0.05)',
  borderRadius: '2px'
})
