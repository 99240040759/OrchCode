import { style } from '@vanilla-extract/css'

export const panelRoot = style({
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-app)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  overflow: 'hidden'
})

export const emptyStateRoot = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  padding: '40px',
  color: 'var(--text-secondary)',
  textAlign: 'center',
  backgroundColor: 'var(--bg-app)'
})

export const emptyStateIcon = style({
  fontSize: '40px',
  marginBottom: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
})

export const emptyStateTitle = style({
  fontSize: 'var(--font-size-lg)',
  color: 'var(--text-primary)',
  fontWeight: 500,
  marginBottom: '6px',
  fontFamily: 'var(--font-display)'
})

export const emptyStateDesc = style({
  fontSize: 'var(--font-size-xs-plus)',
  maxWidth: '300px',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
  margin: 0
})

export const tokenRingWrapper = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'default',
  flexShrink: 0
})

export const tokenRingSvg = style({ transform: 'rotate(-90deg)' })

export const tokenRingCircle = style({
  transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease'
})

export const tokenRingLabel = style({
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
  transition: 'opacity 0.15s ease',
  selectors: {
    [`${tokenRingWrapper}:hover &`]: { opacity: 1 }
  }
})
