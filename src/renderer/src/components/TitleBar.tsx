import React, { useEffect } from 'react'
import { useAtom } from 'jotai'
import { updateStatusAtom, sidebarExpandedAtom, isArtifactPanelOpenAtom } from '../store/agentStore'
import { getSharedWorker } from '../lib/workerManager'
import { PanelLeft, PanelRight } from 'lucide-react'
import * as styles from '../assets/titlebar.css'

interface TitleBarProps {
  title?: string
  workspaceName?: string
}

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const TitleBar: React.FC<TitleBarProps> = ({ title = 'Orch Code', workspaceName }) => {
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
      const currentVersion = await window.updaterBridge.getAppVersion()
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

    window.updaterBridge.getUpdateStatus().then((status) => {
      if (status) {
        if (isMac) {
          runMacWorkerCheck()
        } else {
          setUpdateStatus(status)
        }
      }
    })

    const backgroundWorkerApi = getSharedWorker()
    const unsubscribe = window.updaterBridge.onUpdateStatusChanged((status) => {
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
      intervalId = setInterval(
        () => {
          runMacWorkerCheck()
        },
        3 * 60 * 60 * 1000
      )
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
      window.updaterBridge.installUpdate()
    } else if (updateStatus.status === 'available' && isMac) {
      workerApi?.sendTelemetryEvent('update_download_click', { platform: 'macos' })
      window.updaterBridge.openMacRelease()
    } else if (updateStatus.status === 'error') {
      workerApi?.sendTelemetryEvent('update_retry_click')
      if (isMac) {
        runMacWorkerCheck()
      } else {
        window.updaterBridge.checkForUpdates()
      }
    }
  }

  const renderUpdateIndicator = () => {
    const { status, version, progress, error } = updateStatus

    if (status === 'idle') return null

    let text = ''
    let className = styles.titlebarUpdateBadge

    switch (status) {
      case 'checking':
        text = 'Checking...'
        className += ` ${styles.badgeChecking}`
        break
      case 'available':
        if (isMac) {
          text = `Update Available (v${version})`
          className += ` ${styles.badgeClickable} ${styles.badgeAvailable}`
        } else {
          text = `Downloading update (v${version})...`
          className += ` ${styles.badgeInfo}`
        }
        break
      case 'downloading':
        text = `Downloading: ${progress ?? 0}%`
        className += ` ${styles.badgeDownloading}`
        break
      case 'downloaded':
        text = 'Restart to Update'
        className += ` ${styles.badgeClickable} ${styles.badgeSuccess}`
        break
      case 'error':
        text = 'Update error (click to retry)'
        className += ` ${styles.badgeClickable} ${styles.badgeError}`
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
          <div className={styles.titlebarUpdateProgressBar} style={{ width: `${progress ?? 0}%` }} />
        )}
        <span className={styles.titlebarUpdateText}>{text}</span>
      </div>
    )
  }

  return (
    <header className={styles.titlebar}>
      <div
        className={`${styles.titlebarLeft} ${isMac ? styles.titlebarLeftMac : styles.titlebarLeftWin}`}
      >
        {!sidebarExpanded && (
          <div
            className={styles.titlebarToggleBtn}
            onClick={() => setSidebarExpanded(true)}
            title="Expand Sidebar"
          >
            <PanelLeft size={16} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
        )}
      </div>

      <div className={styles.titlebarCenter}>
        {workspaceName ? workspaceName : title}
      </div>

      <div
        className={`${styles.titlebarRight} ${isMac ? styles.titlebarRightMac : styles.titlebarRightWin}`}
      >
        {renderUpdateIndicator()}

        {!isArtifactPanelOpen && (
          <div
            className={styles.titlebarToggleBtn}
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
