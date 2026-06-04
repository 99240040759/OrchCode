import { style } from '@vanilla-extract/css'

export const sidebarRoot = style({
  position: 'relative',
  overflow: 'hidden',
  width: '250px',
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  backgroundColor: 'var(--bg-sidebar)',
  flexShrink: 0
})

export const sidebarExpanded = style({
  width: 'var(--sidebar-width-expanded)'
})

export const sidebarInner = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%'
})

export const sidebarHeaderRow = style({
  display: 'flex',
  alignItems: 'center',
  height: '38px',
  paddingRight: '12px',
  marginTop: 0,
  gap: '14px',
  flexShrink: 0
})

export const sidebarHeaderRowMac = style({
  paddingLeft: '80px'
})

export const sidebarHeaderRowWin = style({
  paddingLeft: '12px'
})

export const sidebarCollapseBtn = style({
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '24px',
  height: '24px',
  borderRadius: '6px',
  transition: 'background-color 0.2s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  }
})

export const sidebarTopSection = style({
  padding: '8px 12px',
  gap: '4px',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0
})

export const sidebarStartConv = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  userSelect: 'none',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)'
  }
})

export const sidebarDividerContainer = style({
  padding: '0 12px',
  flexShrink: 0
})

export const sidebarDivider = style({
  height: '1px',
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  width: '100%'
})

export const sidebarBody = style({
  flex: 1,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  '::-webkit-scrollbar': { width: '4px' },
  '::-webkit-scrollbar-thumb': {
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '2px'
  }
})

export const sidebarFooter = style({
  padding: '8px 12px',
  flexShrink: 0
})

export const sidebarFooterItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 10px',
  width: '100%',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  }
})

export const googleBtn = style({
  color: 'var(--text-secondary)',
  ':hover': {
    color: 'var(--text-primary)'
  }
})
