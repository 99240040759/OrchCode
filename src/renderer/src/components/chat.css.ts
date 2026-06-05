import { style, globalStyle } from '@vanilla-extract/css'

// ============================================================================
// ChatPane Styles (from ChatPane.css.ts)
// ============================================================================

export const chatPaneRoot = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  position: 'relative',
  contain: 'layout'
})

export const chatPaneContent = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: '100%',
  height: 'calc(100% - var(--titlebar-height))',
  minWidth: 0,
  margin: '0 auto',
  flex: 1
})

export const chatPaneContentFullWidth = style({
  width: '100%',
  maxWidth: '720px'
})

export const chatPaneInput = style({
  padding: '0 24px 20px',
  flexShrink: 0
})

export const chatPaneEmpty = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  width: '100%',
  height: 'calc(100% - var(--titlebar-height))',
  overflowY: 'auto'
})

// ─── Home Prompt View ─────────────────────────────────────────────────────────

export const homePromptView = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: '40px 24px 20px'
})

export const homePromptTitle = style({
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

export const homePromptHeader = style({
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  marginBottom: '12px'
})

export const homePromptChevron = style({
  color: 'var(--text-secondary)',
  marginTop: '2px'
})

export const promptSubLinks = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap'
})

export const promptSubLink = style({
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
  transition: 'color 0.15s ease, background-color 0.15s ease',
  ':hover': {
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    textDecoration: 'none'
  }
})


// ============================================================================
// ChatThread Styles (from ChatThread.css.ts)
// ============================================================================

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


// ============================================================================
// InputBar Styles (from InputBar.css.ts)
// ============================================================================

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


// ============================================================================
// ToolCallBlock Styles (from ToolCallBlock.css.ts)
// ============================================================================

export const toolCallWrapper = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-secondary)',
  marginBottom: 0,
  padding: '2px 6px',
  userSelect: 'none',
  height: '22px',
  contain: 'layout paint',
  borderRadius: '4px',
  backgroundColor: 'transparent',
  transition: 'all 0.15s ease',
  maxWidth: '100%',
  boxSizing: 'border-box',
  border: 'none',
  textDecoration: 'none',
  outline: 'none'
})

export const interactive = style({
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: 'var(--text-primary)',
      backgroundColor: 'rgba(255, 255, 255, 0.04)'
    }
  }
})

export const nonInteractive = style({
  cursor: 'default'
})

export const spinner = style({
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: '1.5px solid var(--text-secondary)',
  borderTopColor: 'transparent',
  animation: 'spin 0.8s linear infinite',
  flexShrink: 0,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
      borderTopColor: 'var(--text-secondary)',
      opacity: 0.5
    }
  }
})

export const iconBlue = style({
  color: '#38bdf8',
  flexShrink: 0
})

export const iconPurple = style({
  color: 'var(--accent-purple)',
  flexShrink: 0
})

export const iconGreen = style({
  color: 'var(--accent-green)',
  flexShrink: 0
})

export const iconLightBlue = style({
  color: '#60a5fa',
  flexShrink: 0
})

export const iconTeal = style({
  color: '#34d399',
  flexShrink: 0
})

export const iconSlate = style({
  color: '#94a3b8',
  flexShrink: 0
})

export const iconPink = style({
  color: '#f472b6',
  flexShrink: 0
})

export const iconLime = style({
  color: '#4ade80',
  flexShrink: 0
})

export const iconSecondary = style({
  color: 'var(--text-secondary)',
  flexShrink: 0
})

export const iconRed = style({
  color: 'var(--accent-red)',
  flexShrink: 0
})

export const mutedText = style({
  color: 'var(--text-muted)',
  fontWeight: 400,
  whiteSpace: 'nowrap'
})

export const iconWrapper = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  opacity: 0.8
})

export const targetText = style({
  color: 'var(--text-secondary)',
  fontWeight: 500,
  fontFamily: 'var(--font-mono)',
  fontSize: '11.5px',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textDecoration: 'none'
})

export const lineRangeText = style({
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10.5px',
  opacity: 0.7,
  marginLeft: -2,
  whiteSpace: 'nowrap'
})

export const diffStats = style({
  display: 'flex',
  gap: 3,
  fontSize: '10px',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  marginLeft: 2,
  flexShrink: 0
})

export const diffAdd = style({
  color: 'var(--accent-green)'
})

export const diffSub = style({
  color: 'var(--accent-red)'
})

export const fileIconWrapper = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})


// ============================================================================
// MarkdownRenderer Styles (from MarkdownRenderer.css.ts)
// ============================================================================

export const markdownContent = style({
  lineHeight: 1.6
})

// Scoped global styles for markdownContent
globalStyle(`${markdownContent} p`, { margin: '4px 0 8px 0' })
globalStyle(`${markdownContent} ul, ${markdownContent} ol`, { margin: '4px 0 8px 16px', padding: 0 })
globalStyle(`${markdownContent} ul`, { listStyle: 'disc' })
globalStyle(`${markdownContent} ol`, { listStyle: 'decimal' })
globalStyle(`${markdownContent} li`, { marginBottom: '2px', lineHeight: 1.55 })
globalStyle(`${markdownContent} blockquote`, {
  borderLeft: '2px solid var(--text-dim)',
  paddingLeft: '10px',
  margin: '6px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'normal'
})
globalStyle(`${markdownContent} h1`, {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 600,
  margin: '14px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.2,
  letterSpacing: '-0.02em'
})
globalStyle(`${markdownContent} h2`, {
  fontSize: 'var(--font-size-lg)',
  fontWeight: 600,
  margin: '12px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.25,
  letterSpacing: '-0.015em'
})
globalStyle(`${markdownContent} h3`, {
  fontSize: 'var(--font-size-md)',
  fontWeight: 600,
  margin: '10px 0 4px',
  color: 'var(--text-primary)',
  lineHeight: 1.3,
  letterSpacing: '-0.01em'
})

// Tables
globalStyle(`${markdownContent} table`, {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '16px 0',
  fontSize: 'var(--font-size-sm)',
  borderRadius: '6px',
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.05)'
})
globalStyle(`${markdownContent} th`, {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
})
globalStyle(`${markdownContent} td`, {
  padding: '8px 12px',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.04)'
})
globalStyle(`${markdownContent} tr:last-child td`, { borderBottom: 'none' })
globalStyle(`${markdownContent} tr:hover td`, { backgroundColor: 'rgba(255, 255, 255, 0.01)' })

// Code
globalStyle(`${markdownContent} :not(pre) > code`, {
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.03)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  color: '#e2b473'
})
globalStyle(`${markdownContent} code`, { fontFamily: 'var(--font-mono)' })
globalStyle(`${markdownContent} code:not([class])`, {
  fontSize: '0.85em',
  background: 'rgba(255, 255, 255, 0.06)',
  padding: '2px 6px',
  borderRadius: '4px',
  color: '#e2b473'
})
globalStyle(`${markdownContent} code[class]`, { fontSize: 'var(--font-size-sm)' })
globalStyle(`${markdownContent} pre`, {
  backgroundColor: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '34px 16px 14px 16px',
  margin: '16px 0',
  overflowX: 'auto',
  position: 'relative'
})
globalStyle(`${markdownContent} pre code`, {
  background: 'transparent',
  padding: 0,
  borderRadius: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs-plus)',
  lineHeight: 1.6,
  color: '#e5e5e5'
})

export const markdownArtifact = style({})

globalStyle(`${markdownArtifact} p`, { margin: '6px 0 12px 0' })
globalStyle(`${markdownArtifact} ul, ${markdownArtifact} ol`, { margin: '6px 0 12px 20px' })
globalStyle(`${markdownArtifact} li`, { marginBottom: '4px', lineHeight: 1.5 })
globalStyle(`${markdownArtifact} pre`, {
  background: 'var(--bg-sidebar)',
  padding: '12px 14px',
  margin: '12px 0',
  fontSize: 'var(--font-size-md)',
  lineHeight: 1.55
})
globalStyle(`${markdownArtifact} blockquote`, {
  borderLeft: '3px solid var(--text-dim)',
  paddingLeft: '12px',
  margin: '10px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'italic'
})
globalStyle(`${markdownArtifact} h1`, {
  fontSize: 'var(--font-size-2xl)',
  margin: '20px 0 10px',
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  fontWeight: 600
})
globalStyle(`${markdownArtifact} h2`, {
  fontSize: 'var(--font-size-xl)',
  margin: '16px 0 8px',
  lineHeight: 1.25,
  letterSpacing: '-0.015em',
  fontWeight: 600
})
globalStyle(`${markdownArtifact} h3`, {
  fontSize: 'var(--font-size-lg)',
  margin: '12px 0 6px',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
  fontWeight: 600
})

export const codeBlockLang = style({
  position: 'absolute',
  top: '8px',
  left: '16px',
  fontSize: 'var(--font-size-xxs)',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  opacity: 0.5,
  textTransform: 'lowercase'
})

export const codeBlockCopyBtn = style({
  position: 'absolute',
  top: '8px',
  right: '16px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  opacity: 0.5,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  borderRadius: '4px',
  transition: 'opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease',
  ':hover': {
    color: 'var(--text-primary)',
    opacity: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
})

export const fileLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  userSelect: 'none',
  cursor: 'pointer',
  margin: '0 2px',
  verticalAlign: 'middle'
})

export const fileNameWrapper = style({
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px'
})

export const preWrapper = style({
  position: 'relative'
})

// ─── Highlight.js Syntax Highlighting ────────────────────────────────────────

globalStyle(`${markdownContent} .hljs-comment, ${markdownContent} .hljs-quote`, { color: '#6a9955', fontStyle: 'italic' })
globalStyle(`${markdownContent} .hljs-keyword, ${markdownContent} .hljs-selector-tag, ${markdownContent} .hljs-addition`, {
  color: '#569cd6',
  fontWeight: 500
})
globalStyle(`${markdownContent} .hljs-number, ${markdownContent} .hljs-string, ${markdownContent} .hljs-meta, ${markdownContent} .hljs-regexp, ${markdownContent} .hljs-attribute`, {
  color: '#ce9178'
})
globalStyle(
  `${markdownContent} .hljs-title, ${markdownContent} .hljs-section, ${markdownContent} .hljs-name, ${markdownContent} .hljs-selector-id, ${markdownContent} .hljs-selector-class`,
  { color: '#dcdcaa' }
)
globalStyle(
  `${markdownContent} .hljs-variable, ${markdownContent} .hljs-template-variable, ${markdownContent} .hljs-type, ${markdownContent} .hljs-built_in, ${markdownContent} .hljs-bullet, ${markdownContent} .hljs-params, ${markdownContent} .hljs-link`,
  { color: '#9cdcfe' }
)
globalStyle(`${markdownContent} .hljs-symbol, ${markdownContent} .hljs-subst, ${markdownContent} .hljs-meta-keyword`, { color: '#c586c0' })
globalStyle(`${markdownContent} .hljs-deletion`, { color: '#f48771' })
globalStyle(`${markdownContent} .hljs-emphasis`, { fontStyle: 'italic' })
globalStyle(`${markdownContent} .hljs-strong`, { fontWeight: 'bold' })
