import { style } from '@vanilla-extract/css'

// ─── Titlebar ─────────────────────────────────────────────────────────────────

export const titlebar = style({
  height: 'var(--titlebar-height)',
  backgroundColor: 'var(--bg-sidebar)',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  // @ts-ignore
  WebkitAppRegion: 'drag',
  position: 'relative',
  zIndex: 100
})

export const titlebarLeft = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0,
  // @ts-ignore
  WebkitAppRegion: 'no-drag'
})

export const titlebarLeftMac = style({
  paddingLeft: '80px',
  width: '108px'
})

export const titlebarLeftWin = style({
  paddingLeft: '12px',
  width: '40px'
})

export const titlebarCenter = style({
  flex: 1,
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  paddingLeft: '16px',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  letterSpacing: '0.02em'
})

export const titlebarRight = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '12px',
  flexShrink: 0,
  // @ts-ignore
  WebkitAppRegion: 'no-drag'
})

export const titlebarRightMac = style({
  paddingRight: '16px'
})

export const titlebarRightWin = style({
  paddingRight: '16px'
})

// ─── Toggle Button ─────────────────────────────────────────────────────────────

export const titlebarToggleBtn = style({
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  }
})

// ─── Update Badge ─────────────────────────────────────────────────────────────

export const titlebarUpdateBadge = style({
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

export const titlebarUpdateText = style({
  position: 'relative',
  zIndex: 2,
  whiteSpace: 'nowrap'
})

export const badgeChecking = style({
  backgroundColor: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px dashed var(--border-color)',
  animation: 'pulse-opacity 2s infinite ease-in-out'
})

export const badgeInfo = style({
  backgroundColor: 'rgba(59, 130, 246, 0.1)',
  color: 'var(--accent-blue)',
  border: '1px solid rgba(59, 130, 246, 0.2)'
})

export const badgeAvailable = style({
  backgroundColor: 'rgba(16, 185, 129, 0.1)',
  color: 'var(--accent-green)',
  border: '1px solid rgba(16, 185, 129, 0.2)',
  ':hover': {
    backgroundColor: 'var(--accent-green)',
    color: 'var(--bg-app)',
    borderColor: 'transparent',
    transform: 'translateY(-1px)'
  }
})

export const badgeSuccess = style({
  backgroundColor: 'var(--accent-green)',
  color: 'var(--bg-app)',
  boxShadow: '0 0 10px rgba(16, 185, 129, 0.15)',
  ':hover': {
    backgroundColor: '#34d399',
    transform: 'translateY(-1px)',
    boxShadow: '0 0 12px rgba(16, 185, 129, 0.3)'
  }
})

export const badgeDownloading = style({
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)'
})

export const badgeError = style({
  backgroundColor: 'rgba(239, 68, 68, 0.1)',
  color: 'var(--accent-red)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  ':hover': {
    backgroundColor: 'var(--accent-red)',
    color: 'var(--text-primary)',
    borderColor: 'transparent',
    transform: 'translateY(-1px)'
  }
})

export const badgeClickable = style({
  cursor: 'pointer'
})

export const titlebarUpdateProgressBar = style({
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

// ─── Profile Avatar ───────────────────────────────────────────────────────────

export const profileAvatarImg = style({
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  objectFit: 'cover',
  flexShrink: 0
})

export const profileAvatarFallback = style({
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  fontWeight: 600,
  backgroundColor: 'rgba(255,255,255,0.1)',
  color: 'var(--text-primary)',
  flexShrink: 0
})

// ─── Profile Dropdown ─────────────────────────────────────────────────────────

export const profileDropdown = style({
  background: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  minWidth: '180px',
  padding: '6px 0',
  zIndex: 1000,
  fontFamily: 'var(--font-display)',
  transformOrigin: 'bottom left'
})

export const nativeDropdownContent = style({
  animation: 'dropdown-fade-in 0.08s cubic-bezier(0.16, 1, 0.3, 1) forwards'
})

export const profileInfo = style({
  padding: '8px 12px'
})

export const profileName = style({
  fontSize: 'var(--font-size-sm)',
  fontWeight: 600,
  color: 'var(--text-primary)'
})

export const profileEmail = style({
  fontSize: 'var(--font-size-xxs)',
  color: 'var(--text-secondary)',
  marginTop: '2px'
})

export const profileSeparator = style({
  height: '1px',
  backgroundColor: 'var(--border-color)',
  margin: '6px 0'
})

export const profileItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  fontSize: 'var(--font-size-xs-plus)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  outline: 'none',
  transition: 'background 0.15s ease',
  ':hover': {
    background: 'rgba(255, 255, 255, 0.06)'
  }
})

export const profileItemLogout = style({
  color: 'var(--accent-red)',
  ':hover': {
    background: 'rgba(239, 68, 68, 0.08)'
  }
})
