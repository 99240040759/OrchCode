import { globalStyle } from '@vanilla-extract/css'

// ─── Buttons ──────────────────────────────────────────────────────────────────

globalStyle('.btn', {
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-sm-plus)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '8px 16px',
  transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
})
globalStyle('.btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.15)'
})
globalStyle('.btn:active', {
  transform: 'scale(0.98)'
})
globalStyle('.btn.primary', {
  backgroundColor: 'var(--text-primary)',
  color: 'var(--bg-app)',
  borderColor: 'transparent'
})
globalStyle('.btn.primary:hover', {
  backgroundColor: '#ffffff'
})

// ─── Shimmer Text ─────────────────────────────────────────────────────────────

globalStyle('.shimmer-text', {
  background:
    'linear-gradient(90deg, rgba(156, 156, 156, 0.4) 0%, rgba(243, 243, 243, 0.95) 50%, rgba(156, 156, 156, 0.4) 100%)',
  backgroundSize: '150% auto',
  backgroundClip: 'text',
  // @ts-ignore
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  animation: 'textShimmer 2.2s infinite linear',
  fontWeight: 500,
  display: 'inline-block'
})

// ─── Browser Nav Buttons (used in BrowserView) ────────────────────────────────

globalStyle('.browser-nav-btn', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  borderRadius: '4px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'color 0.15s ease, background-color 0.15s ease'
})
globalStyle('.browser-nav-btn:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.05)'
})

globalStyle('.browser-url-bar', {
  flex: 1,
  height: '26px',
  borderRadius: '4px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xxs)',
  padding: '0 8px',
  outline: 'none',
  transition: 'border-color 0.15s ease'
})
globalStyle('.browser-url-bar:focus', {
  borderColor: 'var(--border-focus)'
})

// ─── Home Prompt View ─────────────────────────────────────────────────────────

globalStyle('.home-prompt-view', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: '40px 24px 20px'
})

globalStyle('.home-prompt-title', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
})

globalStyle('.prompt-sub-links', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap'
})

globalStyle('.prompt-sub-link', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'none',
  padding: '4px 8px',
  borderRadius: '4px',
  transition: 'color 0.15s ease, background-color 0.15s ease'
})
globalStyle('.prompt-sub-link:hover', {
  color: 'var(--text-secondary)',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  textDecoration: 'none'
})
