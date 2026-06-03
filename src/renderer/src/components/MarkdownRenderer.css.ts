import { globalStyle } from '@vanilla-extract/css'

// ─── Markdown Content ─────────────────────────────────────────────────────────

globalStyle('.markdown-content', { lineHeight: 1.6 })
globalStyle('.markdown-content p', { margin: '4px 0 8px 0' })
globalStyle('.markdown-content ul, .markdown-content ol', { margin: '4px 0 8px 16px', padding: 0 })
globalStyle('.markdown-content ul', { listStyle: 'disc' })
globalStyle('.markdown-content ol', { listStyle: 'decimal' })
globalStyle('.markdown-content li', { marginBottom: '2px', lineHeight: 1.55 })
globalStyle('.markdown-content blockquote', {
  borderLeft: '2px solid var(--text-dim)',
  paddingLeft: '10px',
  margin: '6px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'normal'
})

globalStyle('.markdown-content h1', {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 600,
  margin: '14px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.2,
  letterSpacing: '-0.02em'
})
globalStyle('.markdown-content h2', {
  fontSize: 'var(--font-size-lg)',
  fontWeight: 600,
  margin: '12px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.25,
  letterSpacing: '-0.015em'
})
globalStyle('.markdown-content h3', {
  fontSize: 'var(--font-size-md)',
  fontWeight: 600,
  margin: '10px 0 4px',
  color: 'var(--text-primary)',
  lineHeight: 1.3,
  letterSpacing: '-0.01em'
})

// ─── Tables ───────────────────────────────────────────────────────────────────

globalStyle('.markdown-content table', {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '16px 0',
  fontSize: 'var(--font-size-sm)',
  borderRadius: '6px',
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.05)'
})
globalStyle('.markdown-content th', {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
})
globalStyle('.markdown-content td', {
  padding: '8px 12px',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.04)'
})
globalStyle('.markdown-content tr:last-child td', { borderBottom: 'none' })
globalStyle('.markdown-content tr:hover td', { backgroundColor: 'rgba(255, 255, 255, 0.01)' })

// ─── Code ─────────────────────────────────────────────────────────────────────

globalStyle('.markdown-content :not(pre) > code', {
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.03)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  color: '#e2b473'
})
globalStyle('.markdown-content code', { fontFamily: 'var(--font-mono)' })
globalStyle('.markdown-content code:not([class])', {
  fontSize: '0.85em',
  background: 'rgba(255, 255, 255, 0.06)',
  padding: '2px 6px',
  borderRadius: '4px',
  color: '#e2b473'
})
globalStyle('.markdown-content code[class]', { fontSize: 'var(--font-size-sm)' })

globalStyle('.markdown-content pre', {
  backgroundColor: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '34px 16px 14px 16px',
  margin: '16px 0',
  overflowX: 'auto',
  position: 'relative'
})
globalStyle('.markdown-content pre code', {
  background: 'transparent',
  padding: 0,
  borderRadius: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs-plus)',
  lineHeight: 1.6,
  color: '#e5e5e5'
})

// ─── Code Block Labels & Copy Button ─────────────────────────────────────────

globalStyle('.code-block-lang', {
  position: 'absolute',
  top: '8px',
  left: '16px',
  fontSize: 'var(--font-size-xxs)',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  opacity: 0.5,
  textTransform: 'lowercase'
})

globalStyle('.code-block-copy-btn', {
  position: 'absolute',
  top: '8px',
  right: '16px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  opacity: 0.5,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4px',
  borderRadius: '4px',
  transition: 'opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease'
})
globalStyle('.code-block-copy-btn:hover', {
  color: 'var(--text-primary)',
  opacity: 1,
  backgroundColor: 'rgba(255, 255, 255, 0.05)'
})

// ─── Highlight.js Syntax Highlighting ────────────────────────────────────────

globalStyle('.hljs-comment, .hljs-quote', { color: '#6a9955', fontStyle: 'italic' })
globalStyle('.hljs-keyword, .hljs-selector-tag, .hljs-addition', {
  color: '#569cd6',
  fontWeight: 500
})
globalStyle('.hljs-number, .hljs-string, .hljs-meta, .hljs-regexp, .hljs-attribute', {
  color: '#ce9178'
})
globalStyle(
  '.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class',
  { color: '#dcdcaa' }
)
globalStyle(
  '.hljs-variable, .hljs-template-variable, .hljs-type, .hljs-built_in, .hljs-bullet, .hljs-params, .hljs-link',
  { color: '#9cdcfe' }
)
globalStyle('.hljs-symbol, .hljs-subst, .hljs-meta-keyword', { color: '#c586c0' })
globalStyle('.hljs-deletion', { color: '#f48771' })
globalStyle('.hljs-emphasis', { fontStyle: 'italic' })
globalStyle('.hljs-strong', { fontWeight: 'bold' })

// ─── Artifact Panel Markdown Overrides ───────────────────────────────────────

globalStyle('.markdown-content.is-artifact p', { margin: '6px 0 12px 0' })
globalStyle('.markdown-content.is-artifact ul, .markdown-content.is-artifact ol', {
  margin: '6px 0 12px 20px'
})
globalStyle('.markdown-content.is-artifact li', { marginBottom: '4px', lineHeight: 1.5 })
globalStyle('.markdown-content.is-artifact pre', {
  background: 'var(--bg-sidebar)',
  padding: '12px 14px',
  margin: '12px 0',
  fontSize: 'var(--font-size-md)',
  lineHeight: 1.55
})
globalStyle('.markdown-content.is-artifact blockquote', {
  borderLeft: '3px solid var(--text-dim)',
  paddingLeft: '12px',
  margin: '10px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'italic'
})
globalStyle('.markdown-content.is-artifact h1', {
  fontSize: 'var(--font-size-2xl)',
  margin: '20px 0 10px',
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  fontWeight: 600
})
globalStyle('.markdown-content.is-artifact h2', {
  fontSize: 'var(--font-size-xl)',
  margin: '16px 0 8px',
  lineHeight: 1.25,
  letterSpacing: '-0.015em',
  fontWeight: 600
})
globalStyle('.markdown-content.is-artifact h3', {
  fontSize: 'var(--font-size-lg)',
  margin: '12px 0 6px',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
  fontWeight: 600
})
