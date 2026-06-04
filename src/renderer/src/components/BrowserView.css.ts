import { style } from '@vanilla-extract/css'

export const browserContainer = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  overflow: 'hidden'
})

export const browserHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  backgroundColor: 'var(--bg-sidebar)',
  borderBottom: '1px solid var(--border-color)',
  flexShrink: 0
})

export const browserNavGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px'
})

export const browserNavBtn = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  borderRadius: '4px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'color 0.15s ease, background-color 0.15s ease',
  ':hover': {
    color: 'var(--text-primary)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
})

export const browserGoBtn = style({
  color: 'var(--accent-blue)'
})

export const browserUrlBar = style({
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
  transition: 'border-color 0.15s ease',
  ':focus': {
    borderColor: 'var(--border-focus)'
  }
})

export const browserTitle = style({
  fontSize: 'var(--font-size-xxs)',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '180px',
  marginLeft: 'auto',
  paddingLeft: '8px'
})

export const browserContent = style({
  flex: 1,
  backgroundColor: 'transparent',
  position: 'relative'
})

export const browserErrorState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: '12px',
  color: 'var(--text-secondary)'
})

export const browserErrorIcon = style({
  color: 'var(--accent-red)'
})

export const browserErrorText = style({
  fontSize: 'var(--font-size-sm)',
  textAlign: 'center',
  maxWidth: '280px'
})

export const browserRetryBtn = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  fontSize: 'var(--font-size-sm)'
})

export const browserLoadingState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)'
})
