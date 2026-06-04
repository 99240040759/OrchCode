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

// ─── Dropdown Menus ───────────────────────────────────────────────────────────

globalStyle('.native-dropdown-content', {
  backgroundColor: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '4px',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  animation: 'dropdown-fade-in 0.15s ease',
  zIndex: 100,
  outline: 'none'
})

globalStyle('.dropdown-menu-content', {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
})

globalStyle('.dropdown-menu-content-sm', {
  minWidth: '160px'
})

globalStyle('.dropdown-menu-content-md', {
  minWidth: '220px'
})

globalStyle('.profile-dropdown-item', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  transition: 'background-color 0.1s ease, color 0.1s ease',
  outline: 'none',
  userSelect: 'none'
})

globalStyle('.profile-dropdown-item:hover, .profile-dropdown-item[data-highlighted]', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  color: 'var(--text-primary)'
})

globalStyle('.profile-dropdown-item.selected', {
  color: 'var(--text-primary)',
  fontWeight: 500
})

