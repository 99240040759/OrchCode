import { globalStyle } from '@vanilla-extract/css'

// ─── InputBar Layout ──────────────────────────────────────────────────────────

globalStyle('.workspace-main', {
  flex: 1,
  minWidth: 0,
  backgroundColor: 'var(--bg-app)',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  position: 'relative',
  contain: 'layout paint'
})

globalStyle('.input-bar-container', {
  width: '100%',
  maxWidth: '685px',
  backgroundColor: 'rgba(24, 24, 27, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '12px',
  display: 'flex',
  flexDirection: 'column',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3), 0 0 1px rgba(255, 255, 255, 0.1)',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
})
globalStyle('.input-bar-container:focus-within', {
  borderColor: 'rgba(255, 255, 255, 0.18)',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.15)'
})

globalStyle('.input-bar-text-area', {
  width: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  resize: 'none',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-md-plus)',
  color: 'var(--text-primary)',
  lineHeight: 1.5
})
globalStyle('.input-bar-text-area::placeholder', {
  color: 'var(--text-secondary)',
  opacity: 0.5
})

globalStyle('.input-bar-text-container-inner', {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px 4px 16px',
  width: '100%',
  boxSizing: 'border-box'
})

globalStyle('.input-bar-text-area-override', {
  flex: 1,
  minWidth: '150px',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  resize: 'none',
  padding: '2px 0',
  margin: 0,
  lineHeight: 1.5,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-md-plus)'
})

globalStyle('.input-bar-toolbar', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px 12px 12px'
})
globalStyle('.input-bar-toolbar-left', {
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
})
globalStyle('.input-bar-toolbar-right', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
})

// ─── Toolbar Elements ─────────────────────────────────────────────────────────

globalStyle('.toolbar-selector', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: '20px',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 500,
  padding: '4px 10px',
  cursor: 'pointer',
  transition: 'all 0.2s ease'
})
globalStyle('.toolbar-selector:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.12)'
})
globalStyle('.toolbar-selector.warning', { color: '#fbbf24' })
globalStyle('.toolbar-selector.warning:hover', { color: '#fcd34d' })

globalStyle('.toolbar-icon-btn', {
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '4px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.2s ease, background-color 0.2s ease'
})
globalStyle('.toolbar-icon-btn:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.05)'
})

globalStyle('.toolbar-submit-btn', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  color: 'var(--text-primary)',
  border: 'none',
  borderRadius: '50%',
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
})
globalStyle('.toolbar-submit-btn:hover', {
  backgroundColor: 'var(--text-primary)',
  color: 'var(--bg-app)',
  transform: 'scale(1.05)'
})
globalStyle('.toolbar-submit-btn:active', {
  transform: 'scale(0.95)'
})

// ─── File Suggestions ─────────────────────────────────────────────────────────

globalStyle('.input-file-suggestions', {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  right: 0,
  maxHeight: '220px',
  overflowY: 'auto',
  backgroundColor: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
  zIndex: 1000,
  padding: '4px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  backdropFilter: 'blur(8px)',
  color: 'var(--text-primary)'
})

globalStyle('.input-file-suggestion-item', {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease'
})
globalStyle('.input-file-suggestion-item.selected', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)'
})

globalStyle('.input-file-icon', {
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

globalStyle('.input-file-details', {
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flex: 1
})

globalStyle('.input-file-name', {
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})
globalStyle('.input-file-suggestion-item.selected .input-file-name', {
  color: 'var(--text-primary)'
})

globalStyle('.input-file-dir', {
  fontSize: '11px',
  color: 'var(--text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

globalStyle('.input-file-reference', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  userSelect: 'none',
  cursor: 'default',
  margin: '0 2px',
  verticalAlign: 'middle'
})

globalStyle('.input-file-reference-name', {
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px'
})

// ─── Attachments ──────────────────────────────────────────────────────────────

globalStyle('.input-attachments-container', {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-color)',
  alignItems: 'center',
  maxHeight: '120px',
  overflowY: 'auto'
})

globalStyle('.input-attachment-chip', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  borderRadius: '4px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--border-color)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)'
})
globalStyle('.input-attachment-chip img', {
  width: '16px',
  height: '16px',
  borderRadius: '2px',
  objectFit: 'cover'
})

globalStyle('.input-attachment-name', {
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

globalStyle('.input-attachment-close', {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-xxs)',
  transition: 'color 0.15s ease'
})
globalStyle('.input-attachment-close:hover', {
  color: 'var(--accent-red)'
})

// ─── Token Ring ───────────────────────────────────────────────────────────────

globalStyle('.token-ring-wrapper', {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'default',
  flexShrink: 0
})
globalStyle('.token-ring-svg', { transform: 'rotate(-90deg)' })
globalStyle('.token-ring-circle', {
  transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease'
})
globalStyle('.token-ring-label', {
  position: 'absolute',
  fontSize: 'var(--font-size-micro)',
  fontWeight: 700,
  fontFamily: 'var(--font-mono)',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
  lineHeight: 1,
  letterSpacing: '-0.03em',
  opacity: 0,
  transition: 'opacity 0.15s ease'
})
globalStyle('.token-ring-wrapper:hover .token-ring-label', { opacity: 1 })

// ─── Home Prompt ──────────────────────────────────────────────────────────────

globalStyle('.home-prompt-header', {
  marginBottom: '24px',
  textAlign: 'center'
})

globalStyle('.home-prompt-title', {
  fontSize: 'var(--font-size-3xl)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  cursor: 'pointer'
})
globalStyle('.home-prompt-title-selector', {
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-3xl)',
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'pointer'
})
globalStyle('.home-prompt-title-selector:hover', {
  color: 'var(--text-primary)'
})

globalStyle('.prompt-sub-links', {
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  marginTop: '10px',
  fontSize: 'var(--font-size-sm)',
  width: '100%',
  maxWidth: '685px',
  justifyContent: 'flex-start'
})
globalStyle('.prompt-sub-link', {
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  transition: 'color 0.2s ease',
  textDecoration: 'none'
})
globalStyle('.prompt-sub-link:hover', { color: 'var(--text-primary)' })

// ─── Dropdown Selected State ──────────────────────────────────────────────────

globalStyle('.profile-dropdown-item.selected', {
  background: 'rgba(255, 255, 255, 0.05)',
  color: 'var(--text-primary)'
})
