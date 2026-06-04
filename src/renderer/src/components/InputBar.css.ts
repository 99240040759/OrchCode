import { style } from '@vanilla-extract/css'

// ─── InputBar Layout ──────────────────────────────────────────────────────────

export const inputBarContainer = style({
  width: '100%',
  maxWidth: '720px',
  backgroundColor: 'rgba(24, 24, 27, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '12px',
  display: 'flex',
  flexDirection: 'column',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.3), 0 0 1px rgba(255, 255, 255, 0.1)',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  position: 'relative',
  ':focus-within': {
    borderColor: 'rgba(255, 255, 255, 0.18)',
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45), 0 0 1px rgba(255, 255, 255, 0.15)'
  }
})

export const inputBarTextArea = style({
  width: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  resize: 'none',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-md-plus)',
  color: 'var(--text-primary)',
  lineHeight: 1.5,
  '::placeholder': {
    color: 'var(--text-secondary)',
    opacity: 0.5
  }
})

export const inputBarTextContainerInner = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px 4px 16px',
  width: '100%',
  boxSizing: 'border-box'
})

export const inputBarTextAreaOverride = style({
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

export const inputBarToolbar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px 12px 12px'
})

export const inputBarToolbarLeft = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
})

export const inputBarToolbarRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
})

// ─── Toolbar Elements ─────────────────────────────────────────────────────────

export const toolbarSelector = style({
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
  transition: 'all 0.2s ease',
  ':hover': {
    color: 'var(--text-primary)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)'
  }
})

export const toolbarIconBtn = style({
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: '4px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.2s ease, background-color 0.2s ease',
  ':hover': {
    color: 'var(--text-primary)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
})

export const toolbarSubmitBtn = style({
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
  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  ':hover': {
    backgroundColor: 'var(--text-primary)',
    color: 'var(--bg-app)',
    transform: 'scale(1.05)'
  },
  ':active': {
    transform: 'scale(0.95)'
  },
  ':disabled': {
    opacity: 0.35,
    cursor: 'not-allowed',
    transform: 'none'
  }
})


// ─── File Suggestions ─────────────────────────────────────────────────────────

export const inputFileSuggestions = style({
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

export const inputFileSuggestionItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  borderRadius: '4px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease'
})

export const inputFileSuggestionItemSelected = style({
  backgroundColor: 'rgba(255, 255, 255, 0.08)'
})

export const inputFileIcon = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

export const inputFileDetails = style({
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flex: 1
})

export const inputFileName = style({
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    [`${inputFileSuggestionItemSelected} &`]: {
      color: 'var(--text-primary)'
    }
  }
})

export const inputFileDir = style({
  fontSize: '11px',
  color: 'var(--text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

export const inputFileReference = style({
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

export const inputFileReferenceName = style({
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px'
})

// ─── Attachments ──────────────────────────────────────────────────────────────

export const inputAttachmentsContainer = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-color)',
  alignItems: 'center',
  maxHeight: '120px',
  overflowY: 'auto'
})

export const inputAttachmentChip = style({
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

export const inputAttachmentChipImg = style({
  width: '16px',
  height: '16px',
  borderRadius: '2px',
  objectFit: 'cover'
})

export const inputAttachmentName = style({
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

export const inputAttachmentClose = style({
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-xxs)',
  transition: 'color 0.15s ease',
  ':hover': {
    color: 'var(--accent-red)'
  }
})
