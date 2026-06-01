import { createGlobalTheme } from '@vanilla-extract/css'

/**
 * Vanilla-extract design token contract.
 * Only stores values that are NOT already CSS custom properties —
 * this prevents circular `var(--x): var(--x)` anti-patterns.
 *
 * All color values here are the single source of truth and are also
 * mapped to CSS custom properties on :root by the theme runtime.
 */
export const vars = createGlobalTheme(':root', {
  colors: {
    bgApp: '#090909',
    bgSidebar: '#090909',
    bgEditor: '#090909',
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
  }
})
