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
  verticalAlign: 'middle'
})
