import React, { useEffect, useCallback } from 'react'
import { useAtom } from 'jotai'
import { updateStatusAtom } from '../store/agentStore'

import type { UpdateStatus } from '../../preload/index.d'

interface TitleBarProps { title?: string; workspaceName?: string }

const isMac = window.api.platform === 'darwin'

const isNewerVersion = (l: string, c: string): boolean => {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [lM, lm, lP] = parse(l), [cM, cm, cP] = parse(c)
  return isNaN(lM) || isNaN(cM) ? l !== c : lM > cM || (lM === cM && (lm > cm || (lm === cm && lP > cP)))
}

const TitleBar: React.FC<TitleBarProps> = ({ title = 'Orch Code', workspaceName }) => {
  const [updateStatus, setUpdateStatus] = useAtom(updateStatusAtom)

  const runMacWorkerCheck = useCallback(async () => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    setUpdateStatus({ status: 'checking' })
    try {
      const currentVersion = await window.api.invoke('app:get-version') as string
      const res = await fetch('https://api.github.com/repos/sameer786ss/OrchCode/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) { setUpdateStatus({ status: 'idle' }); return }
      const data = await res.json()
      const latestVersion: string = data.tag_name?.replace(/^v/, '') ?? ''
      const hasUpdate = !!latestVersion && isNewerVersion(latestVersion, currentVersion)
      setUpdateStatus(hasUpdate ? { status: 'available', version: latestVersion } : { status: 'idle', version: latestVersion })
    } catch (err: any) { setUpdateStatus({ status: 'error', error: err.message }) }
  }, [setUpdateStatus])

  useEffect(() => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    window.api.invoke('updater:get-status').then((status) => {
      if (status) { if (isMac) runMacWorkerCheck(); else setUpdateStatus(status as UpdateStatus) }
    })
    const unsubscribe = window.api.on('updater:status-changed', (status) => {
      if (!isMac) setUpdateStatus(status as UpdateStatus)
    })
    let intervalId: ReturnType<typeof setInterval> | null = null
    if (isMac) intervalId = setInterval(() => runMacWorkerCheck(), 3 * 60 * 60 * 1000)
    return () => { unsubscribe(); if (intervalId) clearInterval(intervalId) }
  }, [setUpdateStatus, runMacWorkerCheck])

  const handleUpdateClick = () => {
    if (updateStatus.status === 'downloaded') window.api.invoke('updater:install').catch(console.error)
    else if (updateStatus.status === 'available' && isMac) window.api.invoke('updater:open-mac-release').catch(console.error)
    else if (updateStatus.status === 'error') { if (isMac) runMacWorkerCheck(); else window.api.invoke('updater:check').catch(console.error) }
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
    <header className="titlebar">
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
