import { style } from '@vanilla-extract/css'

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const artifactPane = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  borderLeft: 'none'
})

export const artifactPanelContent = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden'
})

export const artifactPanelTabContent = style({
  height: '100%',
  width: '100%',
  overflow: 'hidden'
})

export const tabContentHidden = style({
  display: 'none !important'
})

export const tabContentVisible = style({
  display: 'block'
})

// ─── Media Preview ────────────────────────────────────────────────────────────

export const mediaPreviewContainer = style({
  scrollbarWidth: 'thin',
  '::-webkit-scrollbar': {
    width: '6px',
    height: '6px'
  },
  '::-webkit-scrollbar-thumb': {
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '3px'
  }
})

export const mediaImageWrapper = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--bg-editor)',
  backgroundImage:
    'linear-gradient(45deg, var(--bg-sidebar) 25%, transparent 25%), linear-gradient(-45deg, var(--bg-sidebar) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg-sidebar) 75%), linear-gradient(-45deg, transparent 75%, var(--bg-sidebar) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  padding: '16px',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  maxWidth: '100%',
  maxHeight: '100%'
})

export const artifactPanelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '38px',
  backgroundColor: 'var(--bg-sidebar)',
  flexShrink: 0,
  overflowX: 'auto',
  scrollbarWidth: 'none'
})

export const artifactPanelHeaderMac = style({
  paddingRight: '12px'
})

export const artifactPanelHeaderWin = style({
  paddingRight: '140px'
})

export const artifactPanelTabsList = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
  overflowX: 'auto',
  scrollbarWidth: 'none'
})

export const tabTrigger = style({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '0 12px',
  backgroundColor: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-xs-plus)',
  cursor: 'pointer',
  transition: 'color 0.15s ease, background-color 0.15s ease',
  outline: 'none',
  position: 'relative',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    color: 'var(--text-primary)'
  },
  selectors: {
    '&[data-state="active"]': {
      color: 'var(--text-primary)',
      backgroundColor: 'var(--bg-editor)',
      borderBottomColor: 'var(--accent-blue)',
      fontWeight: 500
    }
  }
})

export const tabIconWrapper = style({
  width: '14px',
  height: '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  position: 'relative'
})

export const artifactPanelCloseBtn = style({
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease',
  flexShrink: 0,
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  }
})

export const tabCloseBtn = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease, color 0.15s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    color: 'var(--text-primary)'
  }
})

export const editorToolbarAction = style({
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  transition: 'color 0.15s ease',
  ':hover': {
    color: 'var(--text-primary)'
  }
})

export const editorToolbarActionActive = style({
  color: 'var(--accent-blue)'
})

export const artifactIconPurple = style({
  flexShrink: 0,
  color: 'var(--accent-purple)'
})

export const artifactIconGreen = style({
  flexShrink: 0,
  color: 'var(--accent-green)'
})

export const artifactIconSecondary = style({
  flexShrink: 0,
  color: 'var(--text-secondary)'
})

// ─── Media Preview ────────────────────────────────────────────────────────────
// Outer wrapper for the preview panel area

export const mediaPreviewOuter = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'auto',
  backgroundColor: 'var(--bg-app)',
  padding: '24px'
})

export const mediaAudioWrapper = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '16px',
  padding: '32px',
  borderRadius: '8px',
  backgroundColor: 'var(--bg-app)',
  border: '1px solid var(--border-color)'
})

export const mediaAudioLabel = style({
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-mono)'
})

export const mediaUnsupported = style({
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)'
})
