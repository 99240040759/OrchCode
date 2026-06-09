import React, { useEffect } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { updateStatusAtom, sidebarExpandedAtom } from '../store/agentStore'
import type { UpdateStatus } from '../../preload/index.d'
interface TitleBarProps { title?: string; workspaceName?: string }
import { isMac } from '../lib/sharedUtils'

const TitleBar: React.FC<TitleBarProps> = ({ title = 'Orch Code', workspaceName }) => {
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom)
  const sidebarExpanded = useAtomValue(sidebarExpandedAtom)

  useEffect(() => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    window.api.invoke('updater:get-status').then((status) => {
      if (status) setUpdateStatus(status as UpdateStatus)
    })
    const unsubscribe = window.api.on('updater:status-changed', (status) => {
      setUpdateStatus(status as UpdateStatus)
    })
    return () => { unsubscribe() }
  }, [setUpdateStatus])

  const handleUpdateClick = () => {
    if (updateStatus.status === 'downloaded') window.api.invoke('updater:install').catch(console.error)
    else if (updateStatus.status === 'available' && isMac) window.api.invoke('updater:open-mac-release').catch(console.error)
    else if (updateStatus.status === 'error') window.api.invoke('updater:check').catch(console.error)
  }

  const renderUpdateIndicator = () => {
    const { status, version, progress, error } = updateStatus
    if (status === 'idle') return null
    let text = ''
    let extraClass = ''
    switch (status) {
      case 'checking': text = 'Checking...'; extraClass = 'badge-checking'; break
      case 'available': text = isMac ? `Update Available (v${version})` : `Downloading update (v${version})...`; extraClass = isMac ? 'badge-available badge-clickable' : 'badge-info'; break
      case 'downloading': text = `Downloading: ${progress ?? 0}%`; extraClass = 'badge-downloading'; break
      case 'downloaded': text = 'Restart to Update'; extraClass = 'badge-success badge-clickable'; break
      case 'error': text = 'Update error (click to retry)'; extraClass = 'badge-error badge-clickable'; break
      default: return null
    }
    return (
      <div className={`titlebar-update-badge ${extraClass}`} onClick={handleUpdateClick} title={status === 'error' && error ? error : undefined}>
        {status === 'downloading' && <div className="titlebar-update-progress-bar" style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} />}
        <span className="titlebar-update-text">{text}</span>
      </div>
    )
  }

  return (
    <header className={`titlebar ${sidebarExpanded ? 'titlebar-sidebar-expanded' : ''}`}>
      <div className={`titlebar-left ${isMac ? 'titlebar-left-mac' : 'titlebar-left-win'}`}>
      </div>
      <div className="titlebar-center">{workspaceName ? workspaceName : title}</div>
      <div className={`titlebar-right ${isMac ? 'titlebar-right-mac' : 'titlebar-right-win'}`}>
        {renderUpdateIndicator()}
      </div>
    </header>
  )
}

export default TitleBar
