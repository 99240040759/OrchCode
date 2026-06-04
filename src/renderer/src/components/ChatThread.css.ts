import { style } from '@vanilla-extract/css'

// ─── Chat Thread Container ────────────────────────────────────────────────────

export const chatThreadContainer = style({
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
  flexDirection: 'column',
  '::-webkit-scrollbar': {
    display: 'none'
  }
})

export const chatThreadSpacerTop = style({
  height: '16px',
  flexShrink: 0
})

export const chatThreadMessageWrapper = style({
  padding: '0 24px',
  overflowAnchor: 'none'
})

export const chatThreadSpacerBottom = style({
  height: '24px',
  flexShrink: 0,
  overflowAnchor: 'none'
})

export const chatThreadAnchor = style({
  overflowAnchor: 'auto',
  height: '1px',
  marginTop: '-1px'
})

// ─── User Message ─────────────────────────────────────────────────────────────

export const chatMessageUserContainer = style({
  display: 'flex',
  marginBottom: '24px',
  paddingLeft: 0
})

export const chatMessageUser = style({
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

export const chatMessageUserContent = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
})

// ─── Message Attachments ──────────────────────────────────────────────────────

export const messageAttachments = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginBottom: '8px'
})

export const messageAttachmentChip = style({
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
  maxWidth: '160px',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  }
})

export const messageAttachmentChipImg = style({
  width: '20px',
  height: '20px',
  objectFit: 'cover',
  borderRadius: '3px',
  flexShrink: 0
})

export const chatAttachmentIcon = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

export const chatAttachmentName = style({
  maxWidth: '120px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
})

// ─── Assistant Message ────────────────────────────────────────────────────────

export const chatMessageAssistantContainer = style({
  marginBottom: '24px',
  paddingRight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
})

export const chatMessageAssistant = style({
  fontSize: 'var(--font-size-lg)',
  color: 'var(--text-primary)',
  lineHeight: 1.6,
  userSelect: 'text',
  marginBottom: 0
})

export const chatMessageGeneratingContainer = style({
  marginTop: 0,
  padding: '4px 0',
  marginLeft: '2px'
})

export const chatMessageGeneratingText = style({
  fontSize: 'var(--font-size-sm)'
})

// ─── Reasoning Block ──────────────────────────────────────────────────────────

export const chatReasoningDetails = style({
  marginBottom: 0
})

export const chatReasoningSummary = style({
  cursor: 'pointer',
  fontSize: 'var(--font-size-md)',
  color: 'var(--text-secondary)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  userSelect: 'none',
  listStyle: 'none'
})


export const chatReasoningChevron = style({
  transform: 'rotate(-90deg)',
  transition: 'transform 0.12s ease',
  flexShrink: 0,
  color: 'var(--text-secondary)',
  selectors: {
    [`${chatReasoningDetails}[open] &`]: {
      transform: 'rotate(0deg)'
    }
  }
})

export const chatReasoningBody = style({
  marginTop: '6px',
  paddingBottom: '8px',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: 1.6,
  maxHeight: '120px',
  overflowY: 'auto'
})

// ─── Error Block ──────────────────────────────────────────────────────────────

export const chatErrorContainer = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: 'rgba(239, 68, 68, 0.08)',
  border: '1px solid rgba(239, 68, 68, 0.25)',
  margin: '12px 0'
})

export const chatErrorIcon = style({
  color: '#ef4444',
  marginTop: '3px',
  flexShrink: 0
})

export const chatErrorMessage = style({
  fontSize: 'var(--font-size-md)',
  color: 'var(--text-primary)',
  lineHeight: 1.5
})
