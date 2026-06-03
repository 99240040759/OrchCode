import { globalStyle } from '@vanilla-extract/css'

// ─── Radix UI Tabs ────────────────────────────────────────────────────────────

globalStyle('.tab-trigger', {
  padding: '0 16px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  cursor: 'pointer',
  fontSize: 'var(--font-size-xs-plus)',
  border: 'none',
  background: 'transparent',
  transition: 'background-color 0.15s ease, color 0.15s ease',
  color: 'var(--text-secondary)'
})
globalStyle(".tab-trigger[data-state='active']", {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  fontWeight: 500
})
globalStyle('.tab-trigger:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)'
})

// ─── Radix ScrollArea ─────────────────────────────────────────────────────────

globalStyle('.ScrollAreaRoot', {
  width: '100%',
  height: '100%',
  overflow: 'hidden'
})

globalStyle('.ScrollAreaViewport', {
  width: '100%',
  height: '100%',
  borderRadius: 'inherit'
})

globalStyle('.ScrollAreaScrollbar', {
  display: 'flex',
  userSelect: 'none',
  touchAction: 'none',
  padding: '2px',
  background: 'transparent',
  transition: 'background 160ms ease-out',
  width: '8px',
  zIndex: 20
})
globalStyle('.ScrollAreaScrollbar:hover', {
  background: 'rgba(255, 255, 255, 0.02)'
})

globalStyle('.ScrollAreaThumb', {
  flex: 1,
  background: 'rgba(255, 255, 255, 0.15)',
  borderRadius: '10px',
  position: 'relative',
  transition: 'background-color 0.15s ease'
})
globalStyle('.ScrollAreaThumb:hover', {
  background: 'rgba(255, 255, 255, 0.25)'
})

globalStyle('.ScrollAreaCorner', {
  background: 'rgba(0, 0, 0, 0.2)'
})
