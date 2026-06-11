import React, { useState, useRef, useEffect } from 'react'
import { useAtomValue, useAtom } from 'jotai'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react'
import { isArtifactPanelOpenAtom, artifactPanelModeAtom, sidebarExpandedAtom, activeThreadIdAtom, threadBrowserUrlAtom } from '../store/agentStore'
import debounce from 'lodash.debounce'

const BrowserView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = useAtom(threadBrowserUrlAtom)
  const [displayUrl, setDisplayUrl] = useState('')
  const [title, setTitle] = useState('Browser')
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isLoadedRef = useRef(false)
  const panelMode = useAtomValue(artifactPanelModeAtom)
  const isOpen = useAtomValue(isArtifactPanelOpenAtom)
  const sidebarExpanded = useAtomValue(sidebarExpandedAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)

  const getBounds = (): { x: number; y: number; width: number; height: number } => {
    if (!containerRef.current || panelMode !== 'browser' || !isOpen) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
  }

  const navigate = (url: string) => {
    window.api.invoke('browser:navigate', { url }).catch(() => {})
  }

  const openBrowserWithBounds = async () => {
    setLoadError(null)
    try {
      const bounds = getBounds()
      if (bounds.width === 0 || bounds.height === 0) {
        requestAnimationFrame(openBrowserWithBounds)
        return
      }
      await window.api.invoke('browser:open', { url: urlInput, bounds, conversationId: activeThreadId })
      setIsLoaded(true); isLoadedRef.current = true
      window.api.invoke('browser:resize', bounds).catch(() => {})
    } catch (err: any) { console.error('[BrowserView] openBrowser failed:', err); setLoadError(err?.message || 'Failed to open browser. Please try again.') }
  }

  useEffect(() => {
    if (panelMode !== 'browser' || !isOpen) return
    let active = true

    const rafId = requestAnimationFrame(() => { if (!active) return; openBrowserWithBounds() })
    const unsubTitle = window.api.on('browser:title-updated', (t) => { if (active) setTitle(t as string) })
    const unsubUrl = window.api.on('browser:url-changed', (u) => { if (active) { setDisplayUrl(u as string); setUrlInput(u as string) } })

    const debouncedResize = debounce(() => {
      if (active && isLoadedRef.current) {
        const bounds = getBounds()
        if (bounds.width > 0 && bounds.height > 0) window.api.invoke('browser:resize', bounds).catch(() => {})
      }
    }, 50)
    window.addEventListener('resize', debouncedResize)
    const resizeObs = new ResizeObserver(debouncedResize)
    if (containerRef.current) resizeObs.observe(containerRef.current)

    return () => {
      active = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', debouncedResize)
      debouncedResize.cancel()
      resizeObs.disconnect()
      unsubTitle()
      unsubUrl()
      if (!isOpen) window.api.invoke('browser:close').catch(() => {})
      else window.api.invoke('browser:hide').catch(() => {})
      setIsLoaded(false); isLoadedRef.current = false
    }
  }, [panelMode, isOpen, activeThreadId])

  useEffect(() => {
    if (isLoaded) window.api.invoke('browser:resize', getBounds()).catch(() => {})
  }, [sidebarExpanded, isLoaded])

  return (
    <div className="browser-container">
      <div className="browser-header">
        <div className="browser-nav-group">
          <button className="browser-nav-btn" onClick={() => window.api.invoke('browser:back').catch(()=>{})} title="Back"><ArrowLeft size={14} /></button>
          <button className="browser-nav-btn" onClick={() => window.api.invoke('browser:forward').catch(()=>{})} title="Forward"><ArrowRight size={14} /></button>
          <button className="browser-nav-btn" onClick={() => window.api.invoke('browser:reload').catch(()=>{})} title="Reload"><RotateCw size={13} /></button>
        </div>
        <input className="browser-url-bar" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(urlInput) }} spellCheck={false} placeholder="Enter URL or search..." />
        <button className="browser-nav-btn browser-go-btn" onClick={() => navigate(urlInput)} title="Go"><ExternalLink size={13} /></button>
        {title && <div className="browser-title" title={displayUrl || urlInput}>{title}</div>}
      </div>
      <div ref={containerRef} className="browser-content">
        {loadError ? (
          <div className="browser-error-state">
            <AlertCircle size={20} className="browser-error-icon" />
            <span className="browser-error-text">{loadError}</span>
            <button className="browser-nav-btn browser-retry-btn" onClick={openBrowserWithBounds}><RefreshCw size={13} /> Retry</button>
          </div>
        ) : !isLoaded ? (
          <div className="browser-loading-state">Loading browser...</div>
        ) : null}
      </div>
    </div>
  )
}

export default BrowserView
