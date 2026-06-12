import React from 'react'
import { useAtomValue } from 'jotai'
import { updateStatusAtom, activeWorkspaceAtom, activeThreadAtom } from '../store/agentStore'
import { isMac } from '../lib/sharedUtils'
import Tooltip from './Tooltip'

const TitleBar: React.FC = () => {
  const updateStatus = useAtomValue(updateStatusAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const activeThread = useAtomValue(activeThreadAtom)

  const activeThreadTitle = activeThread?.title || 'New Chat'
  const titleText = activeWorkspace ? `${activeWorkspace.name} / ${activeThreadTitle}` : activeThreadTitle

  const handleUpdateClick = () => {
    if (updateStatus.status === 'downloaded') window.api.invoke('updater:install').catch(console.error)
    else if (updateStatus.status === 'available' && isMac) window.api.invoke('updater:open-mac-release').catch(console.error)
    else if (updateStatus.status === 'error') window.api.invoke('updater:check').catch(console.error)
  }

  const renderUpdateIndicator = () => {
    const { status, version, progress, error } = updateStatus
    if (status === 'idle') return null
    let text = '', extraClass = ''
    switch (status) {
      case 'checking': text = 'Checking...'; extraClass = 'badge-checking'; break
      case 'available': text = isMac ? `Update Available (v${version})` : `Downloading update (v${version})...`; extraClass = isMac ? 'badge-available badge-clickable' : 'badge-info'; break
      case 'downloading': text = `Downloading: ${progress ?? 0}%`; extraClass = 'badge-downloading'; break
      case 'downloaded': text = 'Restart to Update'; extraClass = 'badge-success badge-clickable'; break
      case 'error': text = 'Update error (click to retry)'; extraClass = 'badge-error badge-clickable'; break
      default: return null
    }
    return (
      <Tooltip content={status === 'error' && error ? error : undefined}>
        <div className={`titlebar-update-badge ${extraClass}`} onClick={handleUpdateClick}>
          {status === 'downloading' && <div className="titlebar-update-progress-bar" style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} />}
          <span className="titlebar-update-text">{text}</span>
        </div>
      </Tooltip>
    )
  }

  return (
    <header className="custom-titlebar-wrapper">
      <div className="custom-titlebar-left">
        <span className="custom-titlebar-title">{titleText}</span>
      </div>
      <div className="custom-titlebar-right">
        {renderUpdateIndicator()}
        {!isMac && <div className="custom-titlebar-win-spacer" />}
      </div>
    </header>
  )
}

export default TitleBar
