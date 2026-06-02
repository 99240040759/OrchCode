import React, { useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  updateStatusAtom,
  sidebarExpandedAtom,
  isArtifactPanelOpenAtom
} from '../store/agentStore'
import { getSharedWorker } from '../lib/workerManager'
import { PanelLeft, PanelRight } from 'lucide-react'

interface TitleBarProps {
  title?: string
  workspaceName?: string
}

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Orch Code',
  workspaceName
}) => {
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)

  const runMacWorkerCheck = React.useCallback(async () => {
    if (import.meta.env.DEV) {
      setUpdateStatus({ status: 'idle' })
      return
    }
    const backgroundWorkerApi = getSharedWorker()
    if (!backgroundWorkerApi) return
    setUpdateStatus({ status: 'checking' })
    try {
      const currentVersion = await window.api.getAppVersion()
      const result = await backgroundWorkerApi.checkMacUpdate(currentVersion)
      setUpdateStatus(result)

      if (result.status === 'available') {
        backgroundWorkerApi.sendTelemetryEvent('update_available', {
          platform: 'macos',
          version: result.version || 'unknown'
        })
      }
    } catch (err: any) {
      setUpdateStatus({ status: 'error', error: err.message })
    }
  }, [setUpdateStatus])

  useEffect(() => {
    if (import.meta.env.DEV) {
      setUpdateStatus({ status: 'idle' })
      return
    }

    window.api.getUpdateStatus().then((status) => {
      if (status) {
        if (isMac) {
          runMacWorkerCheck()
        } else {
          setUpdateStatus(status)
        }
      }
    })

    const backgroundWorkerApi = getSharedWorker()
    const unsubscribe = window.api.onUpdateStatusChanged((status) => {
      if (!isMac) {
        setUpdateStatus(status)
        if (status.status === 'available') {
          backgroundWorkerApi?.sendTelemetryEvent('update_available', {
            platform: 'windows',
            version: status.version || 'unknown'
          })
        } else if (status.status === 'downloaded') {
          backgroundWorkerApi?.sendTelemetryEvent('update_downloaded', {
            platform: 'windows',
            version: status.version || 'unknown'
          })
        } else if (status.status === 'error') {
          backgroundWorkerApi?.sendTelemetryEvent('update_error', {
            platform: 'windows',
            error: status.error || 'unknown'
          })
        }
      }
    })

    let intervalId: ReturnType<typeof setInterval> | null = null
    if (isMac) {
      intervalId = setInterval(() => {
        runMacWorkerCheck()
      }, 3 * 60 * 60 * 1000)
    }

    return () => {
      unsubscribe()
      if (intervalId) clearInterval(intervalId)
    }
  }, [setUpdateStatus, runMacWorkerCheck])

  const handleUpdateClick = () => {
    const workerApi = getSharedWorker()
    if (updateStatus.status === 'downloaded') {
      workerApi?.sendTelemetryEvent('update_install_click', { platform: 'windows' })
      window.api.installUpdate()
    } else if (updateStatus.status === 'available' && isMac) {
      workerApi?.sendTelemetryEvent('update_download_click', { platform: 'macos' })
      window.api.openMacRelease()
    } else if (updateStatus.status === 'error') {
      workerApi?.sendTelemetryEvent('update_retry_click')
      if (isMac) {
        runMacWorkerCheck()
      } else {
        window.api.checkForUpdates()
      }
    }
  }

  const renderUpdateIndicator = () => {
    const { status, version, progress, error } = updateStatus

    if (status === 'idle') return null

    let text = ''
    let className = 'titlebar-update-badge'

    switch (status) {
      case 'checking':
        text = 'Checking...'
        className += ' checking'
        break
      case 'available':
        if (isMac) {
          text = `Update Available (v${version})`
          className += ' clickable available'
        } else {
          text = `Downloading update (v${version})...`
          className += ' info'
        }
        break
      case 'downloading':
        text = `Downloading: ${progress ?? 0}%`
        className += ' downloading'
        break
      case 'downloaded':
        text = 'Restart to Update'
        className += ' clickable success'
        break
      case 'error':
        text = 'Update error (click to retry)'
        className += ' clickable error'
        break
      default:
        return null
    }

    return (
      <div
        className={className}
        onClick={handleUpdateClick}
        title={status === 'error' && error ? error : undefined}
      >
        {status === 'downloading' && (
          <div
            className="titlebar-update-progress-bar"
            style={{ width: `${progress ?? 0}%` }}
          />
        )}
        <span className="titlebar-update-text">{text}</span>
      </div>
    )
  }

  return (
    <header className="titlebar" style={{ display: 'flex', width: '100%' }}>
      <div
        className="titlebar-left"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            paddingLeft: isMac ? '80px' : '12px',
            width: isMac ? '108px' : '40px',
            flexShrink: 0,
          WebkitAppRegion: 'no-drag'
        } as any}
      >
        {!sidebarExpanded && (
          <div
            className="titlebar-toggle-btn"
            onClick={() => setSidebarExpanded(true)}
            title="Expand Sidebar"
          >
            <PanelLeft size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        )}
      </div>

      <div className="titlebar-center" style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', alignItems: 'center', paddingLeft: '16px' }}>
        {workspaceName ? workspaceName : title}
      </div>

      <div
        className="titlebar-right"
        style={{
          // UI-9: Windows titlebar overlay is 140px wide (set in BrowserWindow config).
          // At non-100% DPI (e.g. 125%) the OS-rendered controls can mis-measure — if the
          // controls bleed into our content, increase this value to match observed width.
          // macOS traffic lights are inset on the left (16px), right side is free.
          paddingRight: isMac ? 16 : 140,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px',
          flexShrink: 0,
          WebkitAppRegion: 'no-drag'
        } as any}
      >
        {renderUpdateIndicator()}

        {!isArtifactPanelOpen && (
          <div
            className="titlebar-toggle-btn"
            onClick={() => setArtifactPanelOpen(true)}
            title="Expand Right Panel"
          >
            <PanelRight size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        )}
      </div>
    </header>
  )
}

export default TitleBar
