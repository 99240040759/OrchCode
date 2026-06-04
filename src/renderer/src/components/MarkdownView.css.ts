/**
 * MarkdownView-specific styles.
 * Shared header styles (container, header, fileInfoContainer, etc.)
 * are in FileViewHeader.css.ts.
 */
import { style } from '@vanilla-extract/css'

export {
  container,
  header,
  fileInfoContainer,
  fileIcon,
  fileName,
  fileDir,
  toolbarGroup,
  editorToolbarAction
} from './FileViewHeader.css'

// ─── Markdown-specific ────────────────────────────────────────────────────────

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
