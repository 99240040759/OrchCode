import { globalStyle } from '@vanilla-extract/css'

// ─── Media Preview ────────────────────────────────────────────────────────────

globalStyle('.media-preview-container', {
  // @ts-ignore
  scrollbarWidth: 'thin'
})
globalStyle('.media-preview-container::-webkit-scrollbar', {
  width: '6px',
  height: '6px'
})
globalStyle('.media-preview-container::-webkit-scrollbar-thumb', {
  background: 'rgba(255, 255, 255, 0.1)',
  borderRadius: '3px'
})

globalStyle('.media-image-wrapper', {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--bg-editor)',
  backgroundImage:
    'linear-gradient(45deg, var(--bg-sidebar) 25%, transparent 25%), linear-gradient(-45deg, var(--bg-sidebar) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg-sidebar) 75%), linear-gradient(-45deg, transparent 75%, var(--bg-sidebar) 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
  padding: '16px',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  maxWidth: '100%',
  maxHeight: '100%'
})
