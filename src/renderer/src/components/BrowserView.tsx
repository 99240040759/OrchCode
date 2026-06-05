import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react'
import { isArtifactPanelOpenAtom, artifactPanelModeAtom, sidebarExpandedAtom } from '../store/agentStore'
import * as styles from './editor.css'

const BrowserView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = useState('https://google.com')
  const [displayUrl, setDisplayUrl] = useState('')
  const [title, setTitle] = useState('Browser')
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isLoadedRef = useRef(false)

  const closedRef = useRef(false)
  const panelMode = useAtomValue(artifactPanelModeAtom)
  const isOpen = useAtomValue(isArtifactPanelOpenAtom)
  const sidebarExpanded = useAtomValue(sidebarExpandedAtom)

  const panelModeRef = useRef(panelMode)
  const isOpenRef = useRef(isOpen)
  const urlInputRef = useRef(urlInput)

  useEffect(() => {
    panelModeRef.current = panelMode
  }, [panelMode])
  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])
  useEffect(() => {
    urlInputRef.current = urlInput
  }, [urlInput])

  const getBounds = useCallback((): { x: number; y: number; width: number; height: number } => {
    if (!containerRef.current || panelModeRef.current !== 'browser' || !isOpenRef.current) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }, [])

  const navigate = useCallback((url: string) => {
    const target = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    window.browserBridge.navigateBrowser(target)
    setUrlInput(target)
  }, [])

  const openBrowserWithBounds = useCallback(async () => {
    setLoadError(null)
    const bounds = getBounds()
    try {
      await window.browserBridge.openBrowser({ url: urlInputRef.current, bounds })
      setIsLoaded(true)
      isLoadedRef.current = true
      // Recalculate bounds and resize to correct any layout changes that happened while opening
      const currentBounds = getBounds()
      window.browserBridge.resizeBrowser(currentBounds).catch(() => {})
    } catch (err: any) {
      console.error('[BrowserView] openBrowser failed:', err)
      setLoadError(err?.message || 'Failed to open browser. Please try again.')
    }
  }, [getBounds])

  useEffect(() => {
    // Guard: only open if panel is in browser mode
    if (panelMode !== 'browser' || !isOpen) return

    closedRef.current = false
    let active = true
    const rafId = requestAnimationFrame(() => {
      if (!active) return
      openBrowserWithBounds()
    })

    const unsubTitle = window.browserBridge.onBrowserTitleUpdated((t) => {
      if (active) setTitle(t)
    })
    const unsubUrl = window.browserBridge.onBrowserUrlChanged((u) => {
      if (active) {
        setDisplayUrl(u)
        setUrlInput(u)
      }
    })

    const handleWindowResize = () => {
      if (active && isLoadedRef.current) {
        window.browserBridge.resizeBrowser(getBounds()).catch(() => {})
      }
    }
    window.addEventListener('resize', handleWindowResize)

    const resizeObs = new ResizeObserver(() => {
      if (active && isLoadedRef.current) {
        window.browserBridge.resizeBrowser(getBounds()).catch(() => {})
      }
    })
    if (containerRef.current) resizeObs.observe(containerRef.current)

    return () => {
      active = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', handleWindowResize)
      resizeObs.disconnect()
      unsubTitle()
      unsubUrl()

      if (!closedRef.current) {
        closedRef.current = true
        window.browserBridge.closeBrowser().catch(() => {})
      }
      setIsLoaded(false)
      isLoadedRef.current = false
    }
  }, [panelMode, isOpen, getBounds, openBrowserWithBounds])

  useEffect(() => {
    if (isLoadedRef.current) {
      const bounds = getBounds()
      window.browserBridge.resizeBrowser(bounds).catch(() => {})
    }
  }, [panelMode, isOpen, sidebarExpanded, getBounds])

  return (
    <div className={styles.browserContainer}>
      <div className={styles.browserHeader}>
        <div className={styles.browserNavGroup}>
          <button className={styles.browserNavBtn} onClick={() => window.browserBridge.browserBack()} title="Back">
            <ArrowLeft size={14} />
          </button>
          <button
            className={styles.browserNavBtn}
            onClick={() => window.browserBridge.browserForward()}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            className={styles.browserNavBtn}
            onClick={() => window.browserBridge.browserReload()}
            title="Reload"
          >
            <RotateCw size={13} />
          </button>
        </div>

        <input
          className={styles.browserUrlBar}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(urlInput)
          }}
          spellCheck={false}
          placeholder="Enter URL or search..."
        />

        <button
          className={`${styles.browserNavBtn} ${styles.browserGoBtn}`}
          onClick={() => navigate(urlInput)}
          title="Go"
        >
          <ExternalLink size={13} />
        </button>

        {title && (
          <div
            className={styles.browserTitle}
            title={displayUrl || urlInput}
          >
            {title}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className={styles.browserContent}
      >
        {loadError ? (
          <div className={styles.browserErrorState}>
            <AlertCircle size={20} className={styles.browserErrorIcon} />
            <span className={styles.browserErrorText}>
              {loadError}
            </span>
            <button
              className={`${styles.browserNavBtn} ${styles.browserRetryBtn}`}
              onClick={openBrowserWithBounds}
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        ) : !isLoaded ? (
          <div className={styles.browserLoadingState}>
            Loading browser...
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default BrowserView
