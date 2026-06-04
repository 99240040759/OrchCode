import { globalStyle, globalKeyframes } from '@vanilla-extract/css'

// ─── CSS Custom Properties (Design Tokens) ───────────────────────────────────

globalStyle(':root', {
  vars: {
    '--font-display': "'Outfit', sans-serif",
    '--font-mono': "'JetBrains Mono', monospace",
    '--bg-app': '#121212',
    '--bg-sidebar': '#1a1a1a',
    '--bg-editor': '#121212',
    '--border-color': '#333333',
    '--border-focus': '#444444',
    '--text-primary': '#ffffff',
    '--text-secondary': '#b4b4b4',
    '--text-muted': '#737373',
    '--text-dim': '#525252',
    '--accent-blue': '#3b82f6',
    '--accent-purple': '#8b5cf6',
    '--accent-green': '#10b981',
    '--accent-orange': '#f59e0b',
    '--accent-red': '#ef4444',
    '--sidebar-width-expanded': '250px',
    '--titlebar-height': '40px',
    '--font-size-micro': '9px',
    '--font-size-xxs': '11px',
    '--font-size-xs': '12px',
    '--font-size-xs-plus': '12.5px',
    '--font-size-sm': '13px',
    '--font-size-sm-plus': '13.5px',
    '--font-size-md': '14px',
    '--font-size-md-plus': '14.5px',
    '--font-size-lg': '15px',
    '--font-size-xl': '17px',
    '--font-size-2xl': '20px',
    '--font-size-3xl': '24px'
  }
})

// ─── Base Reset ───────────────────────────────────────────────────────────────

globalStyle('*, *::before, *::after', {
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
  userSelect: 'none'
})

globalStyle('img', {
  // @ts-ignore
  WebkitUserDrag: 'none'
})

globalStyle(
  'input, textarea, [contenteditable="true"], code, pre, .assistant-content, .markdown-content, .chat-reasoning-body',
  {
    userSelect: 'text'
  }
)

globalStyle('.assistant-content *', {
  userSelect: 'text'
})

globalStyle('body', {
  margin: 0,
  padding: 0,
  backgroundColor: 'var(--bg-app)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-display)',
  fontWeight: 400,
  fontSize: 'var(--font-size-md)',
  lineHeight: 1.5,
  overflow: 'hidden',
  height: '100vh',
  width: '100vw',
  // @ts-ignore
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale'
})

globalStyle('a', {
  color: 'var(--accent-blue)',
  textDecoration: 'none',
  fontWeight: 500,
  transition: 'color 0.15s ease, text-decoration 0.15s ease'
})

globalStyle('a:hover', {
  color: '#60a5fa',
  textDecoration: 'underline'
})

globalStyle('details > summary::-webkit-details-marker', { display: 'none' })
globalStyle('details > summary', { listStyle: 'none' })

globalStyle(
  'button:focus-visible, input:focus-visible, textarea:focus-visible, [tabindex]:focus-visible',
  {
    outline: '2px solid var(--accent-blue)',
    outlineOffset: '2px'
  }
)

globalStyle('*', {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      scrollBehavior: 'auto',
      transitionDuration: '0.01ms !important'
    }
  }
})

// ─── Scrollbars ───────────────────────────────────────────────────────────────

globalStyle('::-webkit-scrollbar', { width: '5px', height: '5px' })
globalStyle('::-webkit-scrollbar-track', { background: 'transparent' })
globalStyle('::-webkit-scrollbar-thumb', {
  background: 'hsla(0, 0%, 100%, 0.08)',
  borderRadius: '9999px',
  border: '1px solid transparent',
  backgroundClip: 'padding-box'
})
globalStyle('::-webkit-scrollbar-thumb:hover', {
  background: 'hsla(0, 0%, 100%, 0.16)',
  border: '1px solid transparent',
  backgroundClip: 'padding-box'
})

// ─── Keyframes ────────────────────────────────────────────────────────────────

globalKeyframes('spin', {
  to: { transform: 'rotate(360deg)' }
})

globalKeyframes('textShimmer', {
  '0%': { backgroundPosition: '-150% 0' },
  '100%': { backgroundPosition: '150% 0' }
})

globalKeyframes('pulse-opacity', {
  '0%, 100%': { opacity: '0.5' },
  '50%': { opacity: '0.9' }
})

globalKeyframes('dropdown-fade-in', {
  from: { opacity: '0', transform: 'scale(0.96) translateY(-6px)' },
  to: { opacity: '1', transform: 'scale(1) translateY(0)' }
})

// ─── Utility Classes ─────────────────────────────────────────────────────────

globalStyle('.shimmer-text', {
  background:
    'linear-gradient(90deg, var(--text-muted) 25%, var(--text-secondary) 50%, var(--text-muted) 75%)',
  backgroundSize: '200% auto',
  color: 'transparent',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  animation: 'textShimmer 1.6s linear infinite',
  fontSize: 'inherit'
})

globalStyle('.hidden-input', {
  display: 'none'
})

globalStyle('.text-primary', {
  color: 'var(--text-primary)'
})

globalStyle('.font-semibold', {
  fontWeight: 600
})

globalStyle('.font-medium', {
  fontWeight: 500
})
