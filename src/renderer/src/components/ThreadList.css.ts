import { style } from '@vanilla-extract/css'

export const threadListContainer = style({
  padding: '12px 0',
  gap: '8px',
  display: 'flex',
  flexDirection: 'column'
})

export const threadListHeader = style({
  padding: '0 16px',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  letterSpacing: '0.5px'
})

export const threadListGroup = style({
  display: 'flex',
  flexDirection: 'column'
})

export const threadGroupHeader = style({
  display: 'flex',
  alignItems: 'center',
  padding: '6px 16px',
  cursor: 'pointer',
  gap: '8px',
  transition: 'background-color 0.15s',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)'
  }
})

export const threadGroupTitle = style({
  fontSize: 'var(--font-size-xs-plus)',
  color: 'var(--text-primary)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1
})

export const threadGroupActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0
})

export const threadItem = style({
  display: 'flex',
  flexDirection: 'column',
  padding: '8px 16px 8px 38px',
  cursor: 'pointer',
  transition: 'background-color 0.15s',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.04)'
  }
})

export const threadItemActive = style({
  backgroundColor: 'rgba(255, 255, 255, 0.08)'
})

export const threadItemTitle = style({
  fontSize: 'var(--font-size-sm)',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginBottom: '2px',
  lineHeight: 1.4
})

export const threadItemActiveTitle = style({
  fontWeight: 600,
  color: '#fff'
})

export const threadItemMeta = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 'var(--font-size-xxs)',
  color: 'var(--text-secondary)'
})

export const sidebarSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
})

export const sidebarSectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px'
})

export const sidebarSectionHeaderAction = style({
  color: 'var(--text-secondary)',
  transition: 'color 0.15s ease',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  ':hover': {
    color: 'var(--text-primary)'
  }
})

export const emptyStateDesc = style({
  fontSize: 'var(--font-size-xs-plus)',
  color: 'var(--text-secondary)'
})
