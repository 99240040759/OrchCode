import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react'
import { isArtifactPanelOpenAtom, artifactPanelModeAtom } from '../store/agentStore'

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
    window.api.navigateBrowser(target)
    setUrlInput(target)
  }, [])

  const openBrowserWithBounds = useCallback(async () => {
    setLoadError(null)
    const bounds = getBounds()
    try {
      await window.api.openBrowser({ url: urlInputRef.current, bounds })
      setIsLoaded(true)
      isLoadedRef.current = true
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

    const unsubTitle = window.api.onBrowserTitleUpdated((t) => {
      if (active) setTitle(t)
    })
    const unsubUrl = window.api.onBrowserUrlChanged((u) => {
      if (active) {
        setDisplayUrl(u)
        setUrlInput(u)
      }
    })

    const resizeObs = new ResizeObserver(() => {
      if (active && isLoadedRef.current) {
        window.api.resizeBrowser(getBounds()).catch(() => {})
      }
    })
    if (containerRef.current) resizeObs.observe(containerRef.current)

    return () => {
      active = false
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      unsubTitle()
      unsubUrl()

      if (!closedRef.current) {
        closedRef.current = true
        window.api.closeBrowser().catch(() => {})
      }
      setIsLoaded(false)
      isLoadedRef.current = false
    }
  }, [panelMode, isOpen, getBounds, openBrowserWithBounds])

  useEffect(() => {
    if (isLoadedRef.current) {
      const bounds = getBounds()
      window.api.resizeBrowser(bounds).catch(() => {})
    }
  }, [panelMode, isOpen, getBounds])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          backgroundColor: 'var(--bg-sidebar)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="browser-nav-btn" onClick={() => window.api.browserBack()} title="Back">
            <ArrowLeft size={14} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={() => window.api.browserForward()}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={() => window.api.browserReload()}
            title="Reload"
          >
            <RotateCw size={13} />
          </button>
        </div>

        <input
          className="browser-url-bar"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(urlInput)
          }}
          spellCheck={false}
          placeholder="Enter URL or search..."
        />

        <button
          className="browser-nav-btn"
          onClick={() => navigate(urlInput)}
          title="Go"
          style={{ color: 'var(--accent-blue)' }}
        >
          <ExternalLink size={13} />
        </button>

        {title && (
          <div
            style={{
              fontSize: 'var(--font-size-xxs)',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
              marginLeft: 'auto',
              paddingLeft: 8
            }}
            title={displayUrl || urlInput}
          >
            {title}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        style={{ flex: 1, backgroundColor: 'transparent', position: 'relative' }}
      >
        {loadError ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 12,
              color: 'var(--text-secondary)'
            }}
          >
            <AlertCircle size={20} style={{ color: 'var(--accent-red)' }} />
            <span style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', maxWidth: 280 }}>
              {loadError}
            </span>
            <button
              className="browser-nav-btn"
              onClick={openBrowserWithBounds}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 'var(--font-size-sm)'
              }}
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        ) : !isLoaded ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)'
            }}
          >
            Loading browser...
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default BrowserView
