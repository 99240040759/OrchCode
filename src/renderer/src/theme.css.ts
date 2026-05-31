import { createGlobalTheme } from '@vanilla-extract/css'

export const vars = createGlobalTheme(':root', {
  colors: {
    bgSidebar: '#161616',
    bgMain: '#1e1e1e',
    border: 'rgba(255, 255, 255, 0.06)',
    borderFocus: 'rgba(255, 255, 255, 0.12)',
    textPrimary: '#f3f3f3',
    textSecondary: '#9c9c9c',
    textMuted: '#5e5e5e',
    textDim: '#3e3e3e',
    accentBlue: '#3b82f6',
    accentGreen: '#10b981',
    accentOrange: '#f59e0b',
    accentPurple: '#8b5cf6',
    accentRed: '#ef4444'
  },
  fonts: {
    mono: 'var(--font-mono)',
    display: 'var(--font-display)'
  },
  fontSizes: {
    xxs: 'var(--font-size-xxs)',
    xs: 'var(--font-size-xs)',
    xsPlus: 'var(--font-size-xs-plus)',
    sm: 'var(--font-size-sm)',
    smPlus: 'var(--font-size-sm-plus)',
    md: 'var(--font-size-md)',
    mdPlus: 'var(--font-size-md-plus)',
    lg: 'var(--font-size-lg)',
    xl: 'var(--font-size-xl)',
    xxl: 'var(--font-size-2xl)',
    xxxl: 'var(--font-size-3xl)'
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px'
  },
  radius: {
    sm: '4px',
    md: '6px',
    lg: '12px'
  }
})
