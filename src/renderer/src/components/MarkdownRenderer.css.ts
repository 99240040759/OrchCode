import { style, globalStyle } from '@vanilla-extract/css'

export const markdownContent = style({
  lineHeight: 1.6
})

// Scoped global styles for markdownContent
globalStyle(`${markdownContent} p`, { margin: '4px 0 8px 0' })
globalStyle(`${markdownContent} ul, ${markdownContent} ol`, { margin: '4px 0 8px 16px', padding: 0 })
globalStyle(`${markdownContent} ul`, { listStyle: 'disc' })
globalStyle(`${markdownContent} ol`, { listStyle: 'decimal' })
globalStyle(`${markdownContent} li`, { marginBottom: '2px', lineHeight: 1.55 })
globalStyle(`${markdownContent} blockquote`, {
  borderLeft: '2px solid var(--text-dim)',
  paddingLeft: '10px',
  margin: '6px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'normal'
})
globalStyle(`${markdownContent} h1`, {
  fontSize: 'var(--font-size-xl)',
  fontWeight: 600,
  margin: '14px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.2,
  letterSpacing: '-0.02em'
})
globalStyle(`${markdownContent} h2`, {
  fontSize: 'var(--font-size-lg)',
  fontWeight: 600,
  margin: '12px 0 6px',
  color: 'var(--text-primary)',
  lineHeight: 1.25,
  letterSpacing: '-0.015em'
})
globalStyle(`${markdownContent} h3`, {
  fontSize: 'var(--font-size-md)',
  fontWeight: 600,
  margin: '10px 0 4px',
  color: 'var(--text-primary)',
  lineHeight: 1.3,
  letterSpacing: '-0.01em'
})

// Tables
globalStyle(`${markdownContent} table`, {
  width: '100%',
  borderCollapse: 'collapse',
  margin: '16px 0',
  fontSize: 'var(--font-size-sm)',
  borderRadius: '6px',
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.05)'
})
globalStyle(`${markdownContent} th`, {
  backgroundColor: 'rgba(255, 255, 255, 0.03)',
  color: 'var(--text-primary)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
})
globalStyle(`${markdownContent} td`, {
  padding: '8px 12px',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.04)'
})
globalStyle(`${markdownContent} tr:last-child td`, { borderBottom: 'none' })
globalStyle(`${markdownContent} tr:hover td`, { backgroundColor: 'rgba(255, 255, 255, 0.01)' })

// Code
globalStyle(`${markdownContent} :not(pre) > code`, {
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.03)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  color: '#e2b473'
})
globalStyle(`${markdownContent} code`, { fontFamily: 'var(--font-mono)' })
globalStyle(`${markdownContent} code:not([class])`, {
  fontSize: '0.85em',
  background: 'rgba(255, 255, 255, 0.06)',
  padding: '2px 6px',
  borderRadius: '4px',
  color: '#e2b473'
})
globalStyle(`${markdownContent} code[class]`, { fontSize: 'var(--font-size-sm)' })
globalStyle(`${markdownContent} pre`, {
  backgroundColor: 'var(--bg-sidebar)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  padding: '34px 16px 14px 16px',
  margin: '16px 0',
  overflowX: 'auto',
  position: 'relative'
})
globalStyle(`${markdownContent} pre code`, {
  background: 'transparent',
  padding: 0,
  borderRadius: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs-plus)',
  lineHeight: 1.6,
  color: '#e5e5e5'
})

export const markdownArtifact = style({})

globalStyle(`${markdownArtifact} p`, { margin: '6px 0 12px 0' })
globalStyle(`${markdownArtifact} ul, ${markdownArtifact} ol`, { margin: '6px 0 12px 20px' })
globalStyle(`${markdownArtifact} li`, { marginBottom: '4px', lineHeight: 1.5 })
globalStyle(`${markdownArtifact} pre`, {
  background: 'var(--bg-sidebar)',
  padding: '12px 14px',
  margin: '12px 0',
  fontSize: 'var(--font-size-md)',
  lineHeight: 1.55
})
globalStyle(`${markdownArtifact} blockquote`, {
  borderLeft: '3px solid var(--text-dim)',
  paddingLeft: '12px',
  margin: '10px 0',
  color: 'var(--text-secondary)',
  fontStyle: 'italic'
})
globalStyle(`${markdownArtifact} h1`, {
  fontSize: 'var(--font-size-2xl)',
  margin: '20px 0 10px',
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  fontWeight: 600
})
globalStyle(`${markdownArtifact} h2`, {
  fontSize: 'var(--font-size-xl)',
  margin: '16px 0 8px',
  lineHeight: 1.25,
  letterSpacing: '-0.015em',
  fontWeight: 600
})
globalStyle(`${markdownArtifact} h3`, {
  fontSize: 'var(--font-size-lg)',
  margin: '12px 0 6px',
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
  fontWeight: 600
})

export const codeBlockLang = style({
  position: 'absolute',
  top: '8px',
  left: '16px',
  fontSize: 'var(--font-size-xxs)',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-secondary)',
  opacity: 0.5,
  textTransform: 'lowercase'
})

export const codeBlockCopyBtn = style({
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
  transition: 'opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease',
  ':hover': {
    color: 'var(--text-primary)',
    opacity: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)'
  }
})

export const fileLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  color: 'var(--text-primary)',
  fontSize: '13px',
  userSelect: 'none',
  cursor: 'pointer',
  margin: '0 2px',
  verticalAlign: 'middle'
})

export const fileIconWrapper = style({
  display: 'inline-block',
  verticalAlign: 'middle',
  flexShrink: 0
})

export const fileNameWrapper = style({
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '13px'
})

export const preWrapper = style({
  position: 'relative'
})

// ─── Highlight.js Syntax Highlighting ────────────────────────────────────────
// Using globalStyle scoped to markdownContent since highlight.js injects raw string classes

globalStyle(`${markdownContent} .hljs-comment, ${markdownContent} .hljs-quote`, { color: '#6a9955', fontStyle: 'italic' })
globalStyle(`${markdownContent} .hljs-keyword, ${markdownContent} .hljs-selector-tag, ${markdownContent} .hljs-addition`, {
  color: '#569cd6',
  fontWeight: 500
})
globalStyle(`${markdownContent} .hljs-number, ${markdownContent} .hljs-string, ${markdownContent} .hljs-meta, ${markdownContent} .hljs-regexp, ${markdownContent} .hljs-attribute`, {
  color: '#ce9178'
})
globalStyle(
  `${markdownContent} .hljs-title, ${markdownContent} .hljs-section, ${markdownContent} .hljs-name, ${markdownContent} .hljs-selector-id, ${markdownContent} .hljs-selector-class`,
  { color: '#dcdcaa' }
)
globalStyle(
  `${markdownContent} .hljs-variable, ${markdownContent} .hljs-template-variable, ${markdownContent} .hljs-type, ${markdownContent} .hljs-built_in, ${markdownContent} .hljs-bullet, ${markdownContent} .hljs-params, ${markdownContent} .hljs-link`,
  { color: '#9cdcfe' }
)
globalStyle(`${markdownContent} .hljs-symbol, ${markdownContent} .hljs-subst, ${markdownContent} .hljs-meta-keyword`, { color: '#c586c0' })
globalStyle(`${markdownContent} .hljs-deletion`, { color: '#f48771' })
globalStyle(`${markdownContent} .hljs-emphasis`, { fontStyle: 'italic' })
globalStyle(`${markdownContent} .hljs-strong`, { fontWeight: 'bold' })
