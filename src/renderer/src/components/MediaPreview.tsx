import React from 'react'

interface MediaPreviewProps {
  displayFile: { name: string; path: string; isBinary?: boolean; mimeType?: string; base64?: string }
}

const MediaPreview: React.FC<MediaPreviewProps> = ({ displayFile }) => {
  const { mimeType, base64, name } = displayFile
  const src = `data:${mimeType};base64,${base64}`
  return (
    <div className="media-preview-outer media-preview-container">
      {mimeType?.startsWith('image/') && (
        <div className="media-image-wrapper">
          <img src={src} alt={name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
        </div>
      )}
      {mimeType?.startsWith('video/') && <video controls autoPlay src={src} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '4px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />}
      {mimeType?.startsWith('audio/') && (
        <div className="media-audio-wrapper">
          <span className="media-audio-label">{name}</span>
          <audio controls autoPlay src={src} style={{ width: '320px' }} />
        </div>
      )}
      {!mimeType?.startsWith('image/') && !mimeType?.startsWith('video/') && !mimeType?.startsWith('audio/') && (
        <div className="media-unsupported">Unsupported preview format ({mimeType})</div>
      )}
    </div>
  )
}
export default MediaPreview
