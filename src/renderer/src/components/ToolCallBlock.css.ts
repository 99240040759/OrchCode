import { style } from '@vanilla-extract/css'
import { vars } from '../theme.css'

export const toolCallWrapper = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: 'var(--font-size-xs)',
  color: vars.colors.textSecondary,
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
      color: vars.colors.textPrimary,
      backgroundColor: 'rgba(255, 255, 255, 0.04)'
    }
  }
})

export const nonInteractive = style({
  cursor: 'default'
})
