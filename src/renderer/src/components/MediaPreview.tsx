import React from 'react'

interface MediaPreviewProps {
  displayFile: {
    name: string
    path: string
    isBinary?: boolean
    mimeType?: string
    base64?: string
  }
}

export const MediaPreview: React.FC<MediaPreviewProps> = ({ displayFile }) => {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        backgroundColor: 'var(--bg-app)',
        padding: '24px'
      }}
      className="media-preview-container"
    >
      {displayFile.mimeType?.startsWith('image/') && (
        <div className="media-image-wrapper">
          <img
            src={`data:${displayFile.mimeType};base64,${displayFile.base64}`}
            alt={displayFile.name}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '4px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
            }}
          />
        </div>
      )}
      {displayFile.mimeType?.startsWith('video/') && (
        <video
          controls
          autoPlay
          src={`data:${displayFile.mimeType};base64,${displayFile.base64}`}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}
        />
      )}
      {displayFile.mimeType?.startsWith('audio/') && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: 32,
            borderRadius: 8,
            backgroundColor: 'var(--bg-app)',
            border: '1px solid var(--border-color)'
          }}
        >
          <span
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            {displayFile.name}
          </span>
          <audio
            controls
            autoPlay
            src={`data:${displayFile.mimeType};base64,${displayFile.base64}`}
            style={{ width: '320px' }}
          />
        </div>
      )}
      {!displayFile.mimeType?.startsWith('image/') &&
        !displayFile.mimeType?.startsWith('video/') &&
        !displayFile.mimeType?.startsWith('audio/') && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Unsupported preview format ({displayFile.mimeType})
          </div>
        )}
    </div>
  )
}
export default MediaPreview
