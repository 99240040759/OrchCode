import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, AlertCircle, RefreshCw } from 'lucide-react'
import { isArtifactPanelOpenAtom, artifactPanelModeAtom, sidebarExpandedAtom, activeThreadIdAtom } from '../store/agentStore'
import { createDebounce } from '../lib/debounce'

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
  const activeThreadId = useAtomValue(activeThreadIdAtom)

  // M-7 FIX: Replace 3 ref-sync useEffects with direct render-time assignments.
  // This is equivalent and avoids 3 scheduled microtasks per render.
  const panelModeRef = useRef(panelMode)
  const isOpenRef = useRef(isOpen)
  const urlInputRef = useRef(urlInput)
  panelModeRef.current = panelMode
  isOpenRef.current = isOpen
  urlInputRef.current = urlInput

  const getBounds = useCallback((): { x: number; y: number; width: number; height: number } => {
    if (!containerRef.current || panelModeRef.current !== 'browser' || !isOpenRef.current) return { x: 0, y: 0, width: 0, height: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
  }, [])

  const navigate = useCallback((url: string) => {
    const target = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
    window.api.invoke('browser:navigate', { url: target }).catch(() => {})
    setUrlInput(target)
  }, [])

  const openBrowserWithBounds = useCallback(async () => {
    setLoadError(null)
    try {
      await window.api.invoke('browser:open', { url: urlInputRef.current, bounds: getBounds(), conversationId: activeThreadId })
      setIsLoaded(true); isLoadedRef.current = true
      window.api.invoke('browser:resize', getBounds()).catch(() => {})
    } catch (err: any) { console.error('[BrowserView] openBrowser failed:', err); setLoadError(err?.message || 'Failed to open browser. Please try again.') }
  }, [getBounds])

  // C-3 FIX: Merged all resize/open logic into a single effect.
  // Previously two effects both depended on panelMode+isOpen and fired simultaneously,
  // sending two browser:resize IPC calls on each panel toggle.
  useEffect(() => {
    if (panelMode !== 'browser' || !isOpen) return
    closedRef.current = false
    let active = true

    const rafId = requestAnimationFrame(() => { if (!active) return; openBrowserWithBounds() })
    const unsubTitle = window.api.on('browser:title-updated', (t) => { if (active) setTitle(t as string) })
    const unsubUrl = window.api.on('browser:url-changed', (u) => { if (active) { setDisplayUrl(u as string); setUrlInput(u as string) } })

    const debouncedResize = createDebounce(() => {
      if (active && isLoadedRef.current) window.api.invoke('browser:resize', getBounds()).catch(() => {})
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
      if (!closedRef.current) { closedRef.current = true; window.api.invoke('browser:close').catch(() => {}) }
      setIsLoaded(false); isLoadedRef.current = false
    }
  }, [panelMode, isOpen, getBounds, openBrowserWithBounds])

  // Sidebar expand/collapse still needs a resize push — but only when browser is already loaded
  useEffect(() => {
    if (isLoadedRef.current) window.api.invoke('browser:resize', getBounds()).catch(() => {})
  }, [sidebarExpanded, getBounds])

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
