import { style } from '@vanilla-extract/css'

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
