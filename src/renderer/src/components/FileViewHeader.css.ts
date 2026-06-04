/**
 * Shared styles for file viewer header bars.
 * Used by CodeEditorView and MarkdownView — both share an identical header structure.
 */
import { style } from '@vanilla-extract/css'

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
