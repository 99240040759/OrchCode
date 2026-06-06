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
          <img src={src} alt={name} className="media-preview-image" />
        </div>
      )}
      {mimeType?.startsWith('video/') && <video controls autoPlay src={src} className="media-preview-video" />}
      {mimeType?.startsWith('audio/') && (
        <div className="media-audio-wrapper">
          <span className="media-audio-label">{name}</span>
          <audio controls autoPlay src={src} className="media-preview-audio" />
        </div>
      )}
      {!mimeType?.startsWith('image/') && !mimeType?.startsWith('video/') && !mimeType?.startsWith('audio/') && (
        <div className="media-unsupported">Unsupported preview format ({mimeType})</div>
      )}
    </div>
  )
}
export default MediaPreview
