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
    bgApp: '#121214',
    bgSidebar: '#0f0f11',
    bgEditor: '#0f0f11',
    border: 'rgba(255, 255, 255, 0.08)',
    borderFocus: 'rgba(255, 255, 255, 0.15)',
    textPrimary: '#e4e4e7',
    textSecondary: '#a1a1aa',
    textMuted: '#71717a',
    textDim: '#52525b',
    accentBlue: '#3b82f6',
    accentGreen: '#10b981',
    accentOrange: '#f59e0b',
    accentPurple: '#8b5cf6',
    accentRed: '#ef4444'
  }
})
