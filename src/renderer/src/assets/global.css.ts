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

// ─── Sidebar Interactive Elements ─────────────────────────────────────────────

globalStyle('.titlebar-toggle-btn', {
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease'
})
globalStyle('.titlebar-toggle-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)'
})

globalStyle('.sidebar-collapse-btn', {
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease'
})
globalStyle('.sidebar-collapse-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)'
})

globalStyle('.sidebar-start-conv', {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '8px 12px',
  borderRadius: '6px',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.06)',
  transition: 'background-color 0.15s ease, border-color 0.15s ease',
  marginBottom: '4px'
})
globalStyle('.sidebar-start-conv:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.07)',
  borderColor: 'rgba(255, 255, 255, 0.1)'
})

globalStyle('.sidebar-menu-item', {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '8px 12px',
  borderRadius: '6px',
  transition: 'color 0.15s ease, background-color 0.15s ease'
})
globalStyle('.sidebar-menu-item:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.02)'
})

globalStyle('.sidebar-footer-item', {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 500,
  borderRadius: '6px',
  padding: '8px 12px',
  width: '100%',
  background: 'none',
  border: 'none',
  textAlign: 'left',
  transition: 'color 0.15s ease, background-color 0.15s ease'
})
globalStyle('.sidebar-footer-item:hover', {
  color: 'var(--text-primary)',
  backgroundColor: 'rgba(255, 255, 255, 0.02)'
})
globalStyle('.sidebar-footer-item.google-btn', {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.05)'
})
globalStyle('.sidebar-footer-item.google-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  borderColor: 'rgba(255, 255, 255, 0.1)'
})

globalStyle('.sidebar-section-header-action', {
  color: 'var(--text-secondary)',
  transition: 'color 0.15s ease',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer'
})
globalStyle('.sidebar-section-header-action:hover', {
  color: 'var(--text-primary)'
})

globalStyle('.workspace-node-actions', {
  opacity: 0,
  transition: 'opacity 0.15s ease'
})
globalStyle('.sidebar-tree-node:hover .workspace-node-actions, .workspace-node-row:hover .workspace-node-actions', {
  opacity: 1
})

globalStyle('.sidebar-tree-node-title .sidebar-section-header-action', {
  opacity: 0,
  transition: 'opacity 0.15s ease'
})
globalStyle('.sidebar-tree-node-title:hover .sidebar-section-header-action', {
  opacity: 1
})

globalStyle('.workspace-node-row', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease',
  borderRadius: '4px'
})
globalStyle('.workspace-node-row:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.02)'
})

globalStyle('.sidebar-tree-node-title', {
  borderRadius: '6px',
  padding: '6px 10px',
  margin: '0 8px 0 0',
  display: 'flex',
  alignItems: 'center',
  transition: 'background-color 0.15s ease'
})
globalStyle('.sidebar-tree-node-title:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.03)'
})
globalStyle('.sidebar-tree-node-title.active', {
  backgroundColor: 'rgba(255, 255, 255, 0.08)'
})

globalStyle('.artifact-panel-close-btn', {
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
  cursor: 'pointer',
  backgroundColor: 'transparent',
  transition: 'background-color 0.15s ease',
  flexShrink: 0
})
globalStyle('.artifact-panel-close-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)'
})

globalStyle('.tab-close-btn', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  transition: 'background-color 0.15s ease, color 0.15s ease'
})
globalStyle('.tab-close-btn:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.15)',
  color: 'var(--text-primary)'
})

globalStyle('.editor-toolbar-action', {
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  transition: 'color 0.15s ease'
})
globalStyle('.editor-toolbar-action:hover', {
  color: 'var(--text-primary)'
})
globalStyle('.editor-toolbar-action.active', {
  color: 'var(--accent-blue)'
})

globalStyle('.overview-item', {
  cursor: 'pointer',
  transition: 'background-color 0.15s ease'
})
globalStyle('.overview-item:hover', {
  backgroundColor: 'rgba(255, 255, 255, 0.04)'
})

// ─── Sidebar Divider ──────────────────────────────────────────────────────────

globalStyle('.sidebar-divider', {
  height: '1px',
  backgroundColor: 'var(--border-color)',
  margin: '8px 0',
  opacity: 0.5
})
