import { style } from '@vanilla-extract/css'

// ─── Buttons ──────────────────────────────────────────────────────────────────

export const btn = style({
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--font-size-sm-plus)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '8px 16px',
  transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)'
  },
  ':active': {
    transform: 'scale(0.98)'
  }
})

export const btnPrimary = style({
  backgroundColor: 'var(--text-primary)',
  color: 'var(--bg-app)',
  borderColor: 'transparent',
  ':hover': {
    backgroundColor: '#ffffff'
  }
})

export const btnGhost = style({
  backgroundColor: 'transparent',
  borderColor: 'transparent',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  }
})

export const btnSm = style({
  padding: '4px 8px',
  fontSize: 'var(--font-size-xs)'
})

export const btnLg = style({
  padding: '12px 24px',
  fontSize: 'var(--font-size-md)'
})

// ─── Icon Buttons ─────────────────────────────────────────────────────────────

export const iconBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '4px',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  color: 'var(--text-secondary)',
  ':hover': {
    color: 'var(--text-primary)'
  },
  ':active': {
    transform: 'scale(0.95)'
  }
})

export const iconBtnSm = style({
  padding: '4px',
  fontSize: '14px'
})

export const iconBtnMd = style({
  padding: '6px',
  fontSize: '16px'
})

export const iconBtnLg = style({
  padding: '8px',
  fontSize: '20px'
})

export const iconBtnGhost = style({
  backgroundColor: 'transparent',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  }
})

export const iconBtnSolid = style({
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  ':hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)'
  }
})

// ─── Cards ────────────────────────────────────────────────────────────────────

export const card = style({
  backgroundColor: 'var(--bg-panel)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '16px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
})

export const cardNoPadding = style({
  padding: '0'
})

// ─── Status Chips ─────────────────────────────────────────────────────────────

export const statusChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '12px',
  fontSize: 'var(--font-size-xxs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
})

export const statusChipDefault = style({
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  color: 'var(--text-secondary)'
})

export const statusChipSuccess = style({
  backgroundColor: 'rgba(16, 185, 129, 0.15)',
  color: '#10b981'
})

export const statusChipWarning = style({
  backgroundColor: 'rgba(245, 158, 11, 0.15)',
  color: '#f59e0b'
})

export const statusChipError = style({
  backgroundColor: 'rgba(239, 68, 68, 0.15)',
  color: '#ef4444'
})

export const statusChipInfo = style({
  backgroundColor: 'rgba(59, 130, 246, 0.15)',
  color: '#3b82f6'
})

// ─── Panels ──────────────────────────────────────────────────────────────────
export const panelRoot = style({
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'var(--bg-app)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  overflow: 'hidden'
})

// ─── Toolbars ────────────────────────────────────────────────────────────────
export const toolbarRoot = style({
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  backgroundColor: 'rgba(255, 255, 255, 0.02)',
  borderBottom: '1px solid var(--border-color)',
  gap: '8px',
  height: '40px',
  flexShrink: 0
})

// ─── Spacers ─────────────────────────────────────────────────────────────────
export const spacerVXs = style({ height: '4px' })
export const spacerVSm = style({ height: '8px' })
export const spacerVMd = style({ height: '16px' })
export const spacerVLg = style({ height: '24px' })
export const spacerVXl = style({ height: '32px' })

export const spacerHXs = style({ width: '4px', display: 'inline-block' })
export const spacerHSm = style({ width: '8px', display: 'inline-block' })
export const spacerHMd = style({ width: '16px', display: 'inline-block' })
export const spacerHLg = style({ width: '24px', display: 'inline-block' })
export const spacerHXl = style({ width: '32px', display: 'inline-block' })

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
  filter: 'grayscale(0.3) contrast(1.2)',
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

// ─── Token Ring ───────────────────────────────────────────────────────────────
// Used by TokenIndicator component

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
