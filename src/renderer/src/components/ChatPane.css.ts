import { style } from '@vanilla-extract/css'

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
