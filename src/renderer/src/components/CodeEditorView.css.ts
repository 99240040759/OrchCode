/**
 * CodeEditorView-specific styles.
 * Shared header styles (container, header, fileInfoContainer, etc.)
 * are in FileViewHeader.css.ts.
 */
import { style, keyframes } from '@vanilla-extract/css'

export {
  container,
  header,
  fileInfoContainer,
  fileIcon,
  fileName,
  fileDir,
  toolbarGroup,
  editorToolbarAction,
  editorToolbarActionActive
} from './FileViewHeader.css'

// ─── Editor-specific ─────────────────────────────────────────────────────────

export const editorContainer = style({
  flex: 1,
  overflow: 'hidden',
  backgroundColor: 'var(--bg-app)'
})

export const loadingContainer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: 'var(--text-secondary)'
})

const spin = keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' }
})

export const loadingSpinner = style({
  width: '16px',
  height: '16px',
  borderRadius: '50%',
  border: '2px solid var(--text-secondary)',
  borderTopColor: 'transparent',
  animation: `${spin} 0.8s linear infinite`,
  marginRight: '8px'
})

export const emptyThemePlaceholder = style({
  width: '100%',
  height: '100%',
  backgroundColor: 'var(--bg-app)'
})
