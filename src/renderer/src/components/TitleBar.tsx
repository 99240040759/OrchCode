import React, { useEffect } from 'react'
import { useAtom } from 'jotai'
import { updateStatusAtom, sidebarExpandedAtom, isArtifactPanelOpenAtom } from '../store/agentStore'
import { getSharedWorker } from '../lib/workerManager'
import { PanelLeft, PanelRight } from 'lucide-react'

interface TitleBarProps { title?: string; workspaceName?: string }

const isMac = window.updaterBridge.platform === 'darwin'

const TitleBar: React.FC<TitleBarProps> = ({ title = 'Orch Code', workspaceName }) => {
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)

  const runMacWorkerCheck = React.useCallback(async () => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    const backgroundWorkerApi = getSharedWorker()
    if (!backgroundWorkerApi) return
    setUpdateStatus({ status: 'checking' })
    try {
      const currentVersion = await window.updaterBridge.getAppVersion()
      const result = await backgroundWorkerApi.checkMacUpdate(currentVersion)
      setUpdateStatus(result)
      if (result.status === 'available') backgroundWorkerApi.sendTelemetryEvent('update_available', { platform: 'macos', version: result.version || 'unknown' })
    } catch (err: any) { setUpdateStatus({ status: 'error', error: err.message }) }
  }, [setUpdateStatus])

  useEffect(() => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    window.updaterBridge.getUpdateStatus().then((status) => {
      if (status) { if (isMac) runMacWorkerCheck(); else setUpdateStatus(status) }
    })
    const backgroundWorkerApi = getSharedWorker()
    const unsubscribe = window.updaterBridge.onUpdateStatusChanged((status) => {
      if (!isMac) {
        setUpdateStatus(status)
        if (status.status === 'available') backgroundWorkerApi?.sendTelemetryEvent('update_available', { platform: 'windows', version: status.version || 'unknown' })
        else if (status.status === 'downloaded') backgroundWorkerApi?.sendTelemetryEvent('update_downloaded', { platform: 'windows', version: status.version || 'unknown' })
        else if (status.status === 'error') backgroundWorkerApi?.sendTelemetryEvent('update_error', { platform: 'windows', error: status.error || 'unknown' })
      }
    })
    let intervalId: ReturnType<typeof setInterval> | null = null
    if (isMac) intervalId = setInterval(() => runMacWorkerCheck(), 3 * 60 * 60 * 1000)
    return () => { unsubscribe(); if (intervalId) clearInterval(intervalId) }
  }, [setUpdateStatus, runMacWorkerCheck])

  const handleUpdateClick = () => {
    const workerApi = getSharedWorker()
    if (updateStatus.status === 'downloaded') { workerApi?.sendTelemetryEvent('update_install_click', { platform: 'windows' }); window.updaterBridge.installUpdate() }
    else if (updateStatus.status === 'available' && isMac) { workerApi?.sendTelemetryEvent('update_download_click', { platform: 'macos' }); window.updaterBridge.openMacRelease() }
    else if (updateStatus.status === 'error') { workerApi?.sendTelemetryEvent('update_retry_click'); if (isMac) runMacWorkerCheck(); else window.updaterBridge.checkForUpdates() }
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
        {status === 'downloading' && <div className="titlebar-update-progress-bar" style={{ width: `${progress ?? 0}%` }} />}
        <span className="titlebar-update-text">{text}</span>
      </div>
    )
  }

  return (
    <header className="titlebar">
      <div className={`titlebar-left ${isMac ? 'titlebar-left-mac' : 'titlebar-left-win'}`}>
        {!sidebarExpanded && (
          <div className="titlebar-toggle-btn" onClick={() => setSidebarExpanded(true)} title="Expand Sidebar">
            <PanelLeft size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        )}
      </div>
      <div className="titlebar-center">{workspaceName ? workspaceName : title}</div>
      <div className={`titlebar-right ${isMac ? 'titlebar-right-mac' : 'titlebar-right-win'}`}>
        {renderUpdateIndicator()}
        {!isArtifactPanelOpen && (
          <div className="titlebar-toggle-btn" onClick={() => setArtifactPanelOpen(true)} title="Expand Right Panel">
            <PanelRight size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        )}
      </div>
    </header>
  )
}

export default TitleBar
