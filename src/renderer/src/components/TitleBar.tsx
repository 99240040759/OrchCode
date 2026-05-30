import React, { useEffect } from 'react'
import { Settings } from 'lucide-react'
import { useAtom } from 'jotai'
import { updateStatusAtom, authUserAtom } from '../store/agentStore'
import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

interface TitleBarProps {
  title?: string
  workspaceName?: string
  onOpenEditor?: () => void
  onSettingsClick?: () => void
}

const isMac = navigator.userAgent.toLowerCase().includes('mac')

// Instantiate background Comlink Web Worker unconditionally to offload UI thread
let backgroundWorkerApi: any = null
try {
  const worker = new BackgroundWorker()
  backgroundWorkerApi = Comlink.wrap(worker)
  // Sync client ID for telemetry
  const clientId = localStorage.getItem('orchcode_client_id')
  if (clientId) {
    backgroundWorkerApi.init(clientId)
  }
} catch (err) {
  console.error('[TitleBar] Failed to spawn Comlink Web Worker thread:', err)
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" style={{ marginRight: '4px' }} xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

const TitleBar: React.FC<TitleBarProps> = ({
  title = 'Orch Code',
  workspaceName,
  onOpenEditor,
  onSettingsClick
}) => {
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom)
  const [authUser, setAuthUser] = useAtom(authUserAtom)

  // Asynchronous off-thread version check
  const runMacWorkerCheck = async () => {
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
  }

  useEffect(() => {
    // Initial status fetch
    window.api.getUpdateStatus().then((status) => {
      if (status) {
        if (isMac) {
          runMacWorkerCheck()
        } else {
          setUpdateStatus(status)
        }
      }
    })

    // Listen for background state transitions (for Windows autoUpdater)
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

    // Recurrent checks every 3 hours via Comlink Worker on Mac
    let intervalId: any = null
    if (isMac) {
      intervalId = setInterval(() => {
        runMacWorkerCheck()
      }, 3 * 60 * 60 * 1000)
    }

    return () => {
      unsubscribe()
      if (intervalId) clearInterval(intervalId)
    }
  }, [setUpdateStatus])

  useEffect(() => {
    // Initial fetch of active user
    window.api.getAuthUser().then((user) => {
      setAuthUser(user)
    })

    // Listen for real-time auth status updates
    const unsubscribeAuth = window.api.onAuthStatusChanged((user) => {
      setAuthUser(user)
    })

    return () => {
      unsubscribeAuth()
    }
  }, [setAuthUser])

  const handleLogin = async () => {
    try {
      await window.api.startGoogleAuth()
    } catch (err) {
      console.error('Google Sign-in failed:', err)
    }
  }

  const handleLogout = async () => {
    try {
      await window.api.logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  const handleUpdateClick = () => {
    if (updateStatus.status === 'downloaded') {
      backgroundWorkerApi?.sendTelemetryEvent('update_install_click', { platform: 'windows' })
      window.api.installUpdate()
    } else if (updateStatus.status === 'available' && isMac) {
      backgroundWorkerApi?.sendTelemetryEvent('update_download_click', { platform: 'macos' })
      window.api.openMacRelease()
    } else if (updateStatus.status === 'error') {
      backgroundWorkerApi?.sendTelemetryEvent('update_retry_click')
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
    <header className="titlebar">
      <div className="titlebar-left" style={{ WebkitAppRegion: 'drag' } as any} />

      <div className="titlebar-center">
        {workspaceName ? workspaceName : title}
      </div>

      <div className="titlebar-right" style={{ paddingRight: isMac ? 8 : 140, display: 'flex', alignItems: 'center', gap: '12px' }}>
        {renderUpdateIndicator()}

        {authUser ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="titlebar-avatar-btn">
                {authUser.photoUrl ? (
                  <img src={authUser.photoUrl} alt={authUser.name} className="titlebar-avatar-img" referrerPolicy="no-referrer" />
                ) : (
                  <div className="titlebar-avatar-fallback">
                    {authUser.name ? authUser.name.charAt(0).toUpperCase() : authUser.email.charAt(0).toUpperCase()}
                  </div>
                )}
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content className="titlebar-profile-dropdown" align="end" sideOffset={5}>
                <div className="profile-dropdown-info">
                  <div className="profile-name">{authUser.name || 'Google User'}</div>
                  <div className="profile-email">{authUser.email}</div>
                </div>
                <DropdownMenu.Separator className="profile-dropdown-separator" />
                <DropdownMenu.Item className="profile-dropdown-item logout" onSelect={handleLogout}>
                  Log Out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <button className="titlebar-action google-btn" onClick={handleLogin}>
            <GoogleIcon />
            <span>Sign In</span>
          </button>
        )}

        <div className="titlebar-action" onClick={onOpenEditor} style={{ fontSize: 13, fontWeight: 500, padding: '4px 8px' }}>
          <span>Open Editor</span>
        </div>

        <Settings size={15} strokeWidth={1.5} className="settings-btn" onClick={onSettingsClick} />
      </div>
    </header>
  )
}

export default TitleBar
