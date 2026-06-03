import { globalStyle } from '@vanilla-extract/css'

// ─── Titlebar ─────────────────────────────────────────────────────────────────

globalStyle('.titlebar', {
  height: 'var(--titlebar-height)',
  backgroundColor: 'var(--bg-sidebar)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  // @ts-ignore
  WebkitAppRegion: 'drag',
  position: 'relative',
  zIndex: 100
})

globalStyle('.titlebar-left', {
  width: '80px',
  // @ts-ignore
  WebkitAppRegion: 'no-drag'
})

globalStyle('.titlebar-center', {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  letterSpacing: '0.02em'
})

globalStyle('.titlebar-right', {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  // @ts-ignore
  WebkitAppRegion: 'no-drag'
})

globalStyle('.titlebar-action', {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  borderRadius: '4px',
  transition: 'all 0.2s ease'
})
globalStyle('.titlebar-action:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.05)'
})

// ─── Update Badge ─────────────────────────────────────────────────────────────

globalStyle('.titlebar-update-badge', {
  position: 'relative',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  height: '24px',
  maxWidth: '240px',
  transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
  contain: 'layout paint',
  willChange: 'opacity, transform'
})

globalStyle('.titlebar-update-text', {
  position: 'relative',
  zIndex: 2,
  whiteSpace: 'nowrap'
})

globalStyle('.titlebar-update-badge.checking', {
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px dashed var(--border-color)',
  animation: 'pulse-opacity 2s infinite ease-in-out'
})
globalStyle('.titlebar-update-badge.info', {
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  color: 'var(--accent-blue)',
  border: '1px solid rgba(59, 130, 246, 0.2)'
})
globalStyle('.titlebar-update-badge.available', {
  backgroundColor: 'rgba(16, 185, 129, 0.1)',
  color: 'var(--accent-green)',
  border: '1px solid rgba(16, 185, 129, 0.2)'
})
globalStyle('.titlebar-update-badge.available:hover', {
  backgroundColor: 'var(--accent-green)',
  color: 'var(--bg-app)',
  borderColor: 'transparent',
  transform: 'translateY(-1px)'
})
globalStyle('.titlebar-update-badge.success', {
  backgroundColor: 'var(--accent-green)',
  color: 'var(--bg-app)',
  boxShadow: '0 0 10px rgba(16, 185, 129, 0.15)'
})
globalStyle('.titlebar-update-badge.success:hover', {
  backgroundColor: '#34d399',
  transform: 'translateY(-1px)',
  boxShadow: '0 0 12px rgba(16, 185, 129, 0.3)'
})
globalStyle('.titlebar-update-badge.downloading', {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)'
})
globalStyle('.titlebar-update-badge.error', {
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: 'var(--accent-red)',
  border: '1px solid rgba(239, 68, 68, 0.2)'
})
globalStyle('.titlebar-update-badge.error:hover', {
  backgroundColor: 'var(--accent-red)',
  color: 'var(--text-primary)',
  borderColor: 'transparent',
  transform: 'translateY(-1px)'
})
globalStyle('.titlebar-update-badge.clickable', {
  cursor: 'pointer'
})

globalStyle('.titlebar-update-progress-bar', {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  background: 'linear-gradient(90deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.15))',
  zIndex: 1,
  transition: 'width 0.3s cubic-bezier(0.1, 0.8, 0.1, 1)',
  willChange: 'width'
})

// ─── Google Button ────────────────────────────────────────────────────────────

globalStyle('.titlebar-action.google-btn', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid var(--border-color)',
  color: 'var(--text-primary)',
  borderRadius: '4px',
  padding: '4px 10px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 600,
  transition: 'all 0.2s ease',
  cursor: 'pointer'
})
globalStyle('.titlebar-action.google-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.15)',
  transform: 'translateY(-1px)'
})

// ─── Profile Dropdown ─────────────────────────────────────────────────────────

globalStyle('.titlebar-profile-dropdown', {
  background: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  minWidth: '180px',
  padding: '6px 0',
  zIndex: 1000,
  fontFamily: 'var(--font-display)'
})

globalStyle('.native-dropdown-content', {
  animation: 'dropdown-fade-in 0.08s cubic-bezier(0.16, 1, 0.3, 1) forwards'
})

globalStyle('.profile-dropdown-info', {
  padding: '8px 12px'
})
globalStyle('.profile-name', {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 600,
  color: 'var(--text-primary)'
})
globalStyle('.profile-email', {
  fontSize: 'var(--font-size-xxs)',
  color: 'var(--text-secondary)',
  marginTop: '2px'
})
globalStyle('.profile-dropdown-separator', {
  height: '1px',
  backgroundColor: 'var(--border-color)',
  margin: '6px 0'
})
globalStyle('.profile-dropdown-item', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  fontSize: 'var(--font-size-xs-plus)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  outline: 'none',
  transition: 'background 0.15s ease'
})
globalStyle('.profile-dropdown-item:hover', {
  background: 'rgba(255, 255, 255, 0.06)'
})
globalStyle('.profile-dropdown-item.logout', {
  color: 'var(--accent-red)'
})
globalStyle('.profile-dropdown-item.logout:hover', {
  background: 'rgba(239, 68, 68, 0.08)'
})
