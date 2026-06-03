import { globalStyle } from '@vanilla-extract/css'

// ─── Chat Thread Container ────────────────────────────────────────────────────

globalStyle('.chat-thread-container', {
  // @ts-ignore
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  flex: 1,
  width: '100%',
  height: '100%',
  overflowY: 'auto',
  overflowX: 'hidden',
  overflowAnchor: 'auto',
  padding: '16px 0 24px',
  display: 'flex',
  flexDirection: 'column'
})
globalStyle('.chat-thread-container::-webkit-scrollbar', {
  display: 'none'
})

globalStyle('.chat-thread-spacer-top', {
  height: '16px',
  flexShrink: 0
})

globalStyle('.chat-thread-message-wrapper', {
  padding: '0 24px',
  overflowAnchor: 'none'
})

globalStyle('.chat-thread-spacer-bottom', {
  height: '24px',
  flexShrink: 0,
  overflowAnchor: 'none'
})

globalStyle('.chat-thread-anchor', {
  overflowAnchor: 'auto',
  height: '1px',
  marginTop: '-1px'
})

// ─── User Message ─────────────────────────────────────────────────────────────

globalStyle('.chat-message-user-container', {
  display: 'flex',
  marginBottom: '24px',
  paddingLeft: 0
})

globalStyle('.chat-message-user', {
  background: 'var(--bg-sidebar)',
  borderRadius: '8px',
  padding: '6px 16px',
  maxWidth: '100%',
  width: '100%',
  fontSize: 'var(--font-size-lg)',
  color: 'var(--text-primary)',
  lineHeight: 1.5,
  userSelect: 'text'
})

globalStyle('.chat-message-user-content', {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
})

// ─── Message Attachments ──────────────────────────────────────────────────────

globalStyle('.message-attachments', {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginBottom: '8px'
})

globalStyle('.message-attachment-chip', {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 8px',
  borderRadius: '6px',
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-secondary)',
  transition: 'background-color 0.15s ease',
  maxWidth: '160px'
})
globalStyle('.message-attachment-chip:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)'
})
globalStyle('.message-attachment-chip img', {
  width: '20px',
  height: '20px',
  objectFit: 'cover',
  borderRadius: '3px',
  flexShrink: 0
})

globalStyle('.chat-attachment-icon', {
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

globalStyle('.chat-attachment-name', {
  maxWidth: '120px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

// ─── Assistant Message ────────────────────────────────────────────────────────

globalStyle('.chat-message-assistant-container', {
  marginBottom: '24px',
  paddingRight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
})

globalStyle('.chat-message-assistant', {
  fontSize: 'var(--font-size-lg)',
  color: 'var(--text-primary)',
  lineHeight: 1.6,
  userSelect: 'text',
  marginBottom: 0
})

globalStyle('.chat-message-generating-container', {
  marginTop: 0,
  padding: '4px 0',
  marginLeft: '2px'
})

globalStyle('.chat-message-generating-text', {
  fontSize: 'var(--font-size-sm)'
})

// ─── Reasoning Block ──────────────────────────────────────────────────────────

globalStyle('.chat-reasoning-details', {
  marginBottom: 0
})

globalStyle('.chat-reasoning-summary', {
  cursor: 'pointer',
  fontSize: 'var(--font-size-md)',
  color: 'var(--text-secondary)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  userSelect: 'none',
  listStyle: 'none'
})

globalStyle('.chat-reasoning-summary-content', {
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  listStyle: 'none'
})

globalStyle('.chat-reasoning-chevron', {
  transform: 'rotate(-90deg)',
  transition: 'transform 0.12s ease',
  flexShrink: 0,
  color: 'var(--text-secondary)'
})

globalStyle('.chat-reasoning-details[open] .chat-reasoning-chevron', {
  transform: 'rotate(0deg)'
})

globalStyle('.chat-reasoning-body', {
  marginTop: '6px',
  paddingBottom: '8px',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: 1.6,
  maxHeight: '120px',
  overflowY: 'auto'
})

// ─── Error Block ──────────────────────────────────────────────────────────────

globalStyle('.chat-error-container', {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: 'rgba(239, 68, 68, 0.08)',
  border: '1px solid rgba(239, 68, 68, 0.25)',
  margin: '12px 0'
})

globalStyle('.chat-error-icon', {
  color: '#ef4444',
  marginTop: '3px',
  flexShrink: 0
})

globalStyle('.chat-error-message', {
  fontSize: 'var(--font-size-md)',
  color: 'var(--text-primary)',
  lineHeight: 1.5
})
