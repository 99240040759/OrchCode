import React from 'react'
import * as styles from './ArtifactPanel.css'

interface MediaPreviewProps {
  displayFile: {
    name: string
    path: string
    isBinary?: boolean
    mimeType?: string
    base64?: string
  }
}

const MediaPreview: React.FC<MediaPreviewProps> = ({ displayFile }) => {
  const { mimeType, base64, name } = displayFile
  const src = `data:${mimeType};base64,${base64}`

  return (
    <div className={`${styles.mediaPreviewOuter} ${styles.mediaPreviewContainer}`}>
      {mimeType?.startsWith('image/') && (
        <div className={styles.mediaImageWrapper}>
          <img
            src={src}
            alt={name}
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
      {mimeType?.startsWith('video/') && (
        <video
          controls
          autoPlay
          src={src}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            borderRadius: '4px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}
        />
      )}
      {mimeType?.startsWith('audio/') && (
        <div className={styles.mediaAudioWrapper}>
          <span className={styles.mediaAudioLabel}>{name}</span>
          <audio controls autoPlay src={src} style={{ width: '320px' }} />
        </div>
      )}
      {!mimeType?.startsWith('image/') &&
        !mimeType?.startsWith('video/') &&
        !mimeType?.startsWith('audio/') && (
          <div className={styles.mediaUnsupported}>Unsupported preview format ({mimeType})</div>
        )}
    </div>
  )
}
export default MediaPreview
