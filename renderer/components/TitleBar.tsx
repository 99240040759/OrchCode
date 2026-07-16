import React, { useEffect, useState } from 'react'
import { TbArrowUpCircle, TbRefresh, TbLayoutSidebar, TbLayoutSidebarRight } from 'react-icons/tb'
import { Button, IconButton } from './button'
import { cn } from '../lib/utils'
import { useAuthStore } from '../lib/authStore'
import * as Sentry from '@sentry/electron/renderer'

interface TitleBarProps {
  sidebarOpen?: boolean
  artifactOpen?: boolean
  onToggleSidebar?: () => void
  onToggleArtifact?: () => void
}

type UpdateStatus =
  | 'checking'
  | 'available'
  | 'mac-available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | undefined

const updateState = { status: undefined as UpdateStatus, version: '' }
const updateListeners = new Set<() => void>()
function notifyUpdateListeners(): void {
  updateListeners.forEach((fn) => fn())
}

export function TitleBar({
  sidebarOpen,
  artifactOpen,
  onToggleSidebar,
  onToggleArtifact
}: TitleBarProps): React.JSX.Element {
  const isMac = window.api.platform === 'darwin'
  const [, forceUpdate] = useState(0)
  const { status: updateStatus, version: updateVersion } = updateState
  const session = useAuthStore((s) => s.session)

  useEffect(() => {
    const rerender = (): void => forceUpdate((n) => n + 1)
    updateListeners.add(rerender)
    const unsub = window.api.onUpdateStatus((info) => {
      updateState.status = info.status as UpdateStatus
      if (info.version) updateState.version = info.version
      notifyUpdateListeners()
    })
    return () => {
      updateListeners.delete(rerender)
      unsub()
    }
  }, [])

  const checkRunRef = React.useRef(false)
  useEffect(() => {
    if (session && !checkRunRef.current) {
      checkRunRef.current = true
      void window.api.appCheckForUpdates().catch((err: unknown) => {
        Sentry.captureException(err)
      })
    }
  }, [session])

  const handleUpdateClick = (): void => {
    if (updateStatus === 'downloaded') void window.api.appRestartAndUpdate()
    else if (updateStatus === 'mac-available') void window.api.appOpenReleases()
  }

  const showUpdateBanner =
    updateStatus &&
    updateStatus !== 'not-available' &&
    updateStatus !== 'checking'

  return (
    <div
      className={cn(
        'absolute top-[2px] left-[4px] right-[4px] h-titlebar bg-transparent flex-shrink-0 flex items-center justify-between z-50 app-region-drag pointer-events-none',
        isMac ? 'pl-[72px] pr-2' : 'pl-2 pr-[135px]'
      )}
    >
      <div className="h-full flex items-center gap-1.5 app-region-no-drag pointer-events-auto">
        {onToggleSidebar && (
          <IconButton
            onClick={onToggleSidebar}
            tooltip={sidebarOpen ? 'Close Sidebar' : 'Open Sidebar'}
            tooltipSide="bottom"
            className={cn(sidebarOpen === false && 'text-tx-muted')}
          >
            <TbLayoutSidebar size={19} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
      <div className="h-full flex items-center gap-1.5 app-region-no-drag pointer-events-auto ml-auto">
        {showUpdateBanner && (
          <div className="flex items-center mr-2">
            {updateStatus === 'downloading' && (
              <span className="text-3xs text-tx-sub flex items-center gap-1 font-sans animate-pulse">
                <TbRefresh size={13} className="animate-spin" />
                <span>Downloading Update...</span>
              </span>
            )}
            {updateStatus === 'available' && (
              <span className="text-3xs text-tx-sub flex items-center gap-1 font-sans animate-pulse">
                <TbRefresh size={13} className="animate-spin" />
                <span>Preparing Update {updateVersion && `(${updateVersion})`}</span>
              </span>
            )}
            {(updateStatus === 'downloaded' || updateStatus === 'mac-available') && (
              <Button
                onClick={handleUpdateClick}
                variant="bright"
                size="xs"
                className="gap-1 px-1.5 h-5 text-3xs"
              >
                <TbArrowUpCircle size={13} />
                {updateStatus === 'downloaded'
                  ? <span>Restart to Update {updateVersion && `(${updateVersion})`}</span>
                  : <span>Update Available {updateVersion && `(${updateVersion})`} ↗</span>}
              </Button>
            )}
            {updateStatus === 'error' && (
              <span className="text-3xs text-destructive flex items-center gap-1 font-sans font-medium">
                Update failed
              </span>
            )}
          </div>
        )}
        {onToggleArtifact && (
          <IconButton
            onClick={onToggleArtifact}
            tooltip="Toggle Editor Panel"
            tooltipSide="bottom"
            className={cn(artifactOpen === false && 'text-tx-muted')}
          >
            <TbLayoutSidebarRight size={19} strokeWidth={1.8} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
