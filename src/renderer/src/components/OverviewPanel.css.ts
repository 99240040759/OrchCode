import { style } from '@vanilla-extract/css'

export const overviewContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '24px 32px',
  backgroundColor: 'var(--bg-app)',
  minHeight: '100%'
})

export const overviewHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0
})

export const overviewTitle = style({
  fontSize: 'var(--font-size-lg)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: 0,
  fontFamily: 'var(--font-display)'
})

export const overviewGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '24px',
  alignItems: 'start'
})

export const overviewPanel = style({
  padding: '16px',
  gap: '12px',
  minHeight: '260px'
})

export const panelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: '8px'
})

export const panelHeaderLeft = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
})

export const panelContent = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  overflowY: 'auto'
})

export const emptyText = style({
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  padding: '8px 4px'
})

export const overviewItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 10px',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-primary)',
  transition: 'background-color 0.15s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
})

export const itemText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1
})

export const itemLineRange = style({
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  flexShrink: 0,
  marginRight: '4px'
})

export const diffStats = style({
  display: 'flex',
  gap: '3px',
  flexShrink: 0
})

export const diffAdd = style({
  color: 'var(--accent-green)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 700
})

export const diffSub = style({
  color: 'var(--accent-red)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 700
})
