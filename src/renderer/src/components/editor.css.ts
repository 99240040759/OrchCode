import { style, keyframes } from '@vanilla-extract/css'

// ============================================================================
// FileViewHeader Styles (from FileViewHeader.css.ts - Shared)
// ============================================================================

export const container = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  flex: 1
})

export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '34px',
  padding: '0 16px',
  backgroundColor: 'var(--bg-app)',
  borderBottom: '1px solid var(--border-color)',
  flexShrink: 0
})

export const fileInfoContainer = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  overflow: 'hidden'
})

export const fileIcon = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

export const fileName = style({
  color: 'var(--text-primary)',
  fontWeight: 500,
  fontSize: 'var(--font-size-sm)',
  whiteSpace: 'nowrap'
})

export const fileDir = style({
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-xs)',
  marginLeft: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
})

export const toolbarGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexShrink: 0
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


// ============================================================================
// ArtifactPanel Styles (from ArtifactPanel.css.ts)
// ============================================================================

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

export const editorLoading = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  color: 'var(--text-secondary)',
  backgroundColor: 'var(--bg-app)',
  fontSize: 'var(--font-size-sm)'
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


// ============================================================================
// BrowserView Styles (from BrowserView.css.ts)
// ============================================================================

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


// ============================================================================
// CodeEditorView Styles (from CodeEditorView.css.ts)
// ============================================================================

export const editorContainer = style({
  flex: 1,
  overflow: 'hidden',
  backgroundColor: 'var(--bg-app)'
})

export const loadingContainer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--text-secondary)'
})

const spin = keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' }
})

export const loadingSpinner = style({
  width: '16px',
  height: '16px',
  borderRadius: '50%',
  border: '2px solid var(--text-secondary)',
  borderTopColor: 'transparent',
  animation: `${spin} 0.8s linear infinite`,
  marginRight: '8px'
})

export const emptyThemePlaceholder = style({
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--bg-app)'
})


// ============================================================================
// MarkdownView Styles (from MarkdownView.css.ts)
// ============================================================================

export const actionButtonGroup = style({
  display: 'flex',
  gap: '6px',
  marginRight: '8px'
})

export const rejectBtn = style({
  padding: '2px 10px',
  fontSize: 'var(--font-size-xxs)',
  height: '22px',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '4px',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontFamily: 'var(--font-display)',
  transition: 'all 0.15s ease',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.2)'
  }
})

export const proceedBtn = style({
  padding: '2px 10px',
  fontSize: 'var(--font-size-xxs)',
  height: '22px',
  backgroundColor: 'var(--accent-blue)',
  border: '1px solid transparent',
  borderRadius: '4px',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  transition: 'all 0.15s ease',
  ':hover': {
    backgroundColor: '#2563eb'
  }
})

export const contentContainer = style({
  flex: 1,
  overflowY: 'auto',
  padding: '24px 32px',
  backgroundColor: 'var(--bg-app)',
  color: 'var(--text-primary)',
  lineHeight: 1.6,
  fontSize: 'var(--font-size-md-plus)',
  userSelect: 'text'
})


// ============================================================================
// OverviewPanel Styles (from OverviewPanel.css.ts)
// ============================================================================

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
