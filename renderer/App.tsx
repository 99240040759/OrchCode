import React, { useState, useEffect, useRef } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import LeftSidebar from './components/LeftSidebar'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './lib/uiUtils'
import {
  sidebarExpandedAtom, isArtifactPanelOpenAtom, activeThreadAtom,
  globalPromptTriggerAtom, availableModelsAtom, selectedModelAtom, authUserAtom,
  artifactPanelModeAtom, updateStatusAtom
} from './store/agentStore'
import { useChat } from './hooks/useChat'
import { ChatPane } from './components/ChatPane'
import TitleBar from './components/TitleBar'
import { authService } from './services/services'
import { threadService } from './services/services'
import { isMac } from './lib/sharedUtils'
import { PanelLeft, PanelRight, ArrowLeft, ArrowRight } from 'lucide-react'
import type { UpdateStatus } from '../preload/index.d'

function AppInner(): React.JSX.Element {
  const setAvailableModels = useSetAtom(availableModelsAtom)
  const setAuthUser = useSetAtom(authUserAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const activeThreadTitle = activeThread?.title || 'New Chat'
  const chatActions = useChat()
  const { run, stop, openWorkspace, newConversation, loadThreads, selectThread } = chatActions
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)
  const availableModels = useAtomValue(availableModelsAtom)
  const sessionInitialized = useRef(false)
  const setUpdateStatus = useSetAtom(updateStatusAtom)

  useEffect(() => {
    if (import.meta.env.DEV) { setUpdateStatus({ status: 'idle' }); return }
    window.api.invoke('updater:get-status').then((status) => { if (status) setUpdateStatus(status as UpdateStatus) })
    const unsubscribe = window.api.on('updater:status-changed', (status) => { setUpdateStatus(status as UpdateStatus) })
    return () => { unsubscribe() }
  }, [setUpdateStatus])

  // Renderer-side keyboard shortcuts not covered by Electron menu accelerators
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        const inputEl = document.querySelector<HTMLElement>('.input-bar-text-area')
        if (document.activeElement === inputEl) return
        stop()
        return
      }
      if (mod && e.key === 'k') {
        e.preventDefault()
        const el = document.querySelector<HTMLElement>('.input-bar-text-area')
        if (el) { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stop])

  useEffect(() => {
    let cb: (() => void) | undefined
    if (globalPrompt) {
      if (globalPrompt?.prompt) {
        run(globalPrompt.prompt, undefined, globalPrompt.threadId)
        setGlobalPrompt(null)
      } else {
        const timer = setTimeout(() => setGlobalPrompt(null), 5000)
        cb = () => clearTimeout(timer)
      }
    }
    return cb
  }, [globalPrompt, run, setGlobalPrompt, availableModels])

  useEffect(() => {
    authService.getAuthUser().then(u => setAuthUser(u ?? null)).catch(() => setAuthUser(null))
    return authService.onAuthStatusChanged(u => setAuthUser(u ?? null))
  }, [setAuthUser])

  useEffect(() => {
    if (sessionInitialized.current) return
    sessionInitialized.current = true
    threadService.getConversationId().then(cid => { if (cid) selectThread(cid) }).catch(console.error)
    loadThreads().catch(console.error)
  }, [selectThread, loadThreads])

  useEffect(() => {
    window.api.invoke('models:list').then((m: unknown) => {
      const models = m as Record<string, { id: string; name: string }> | undefined
      if (models) {
        setAvailableModels(models)
        // Only set default once — use functional update to read current value without adding to deps
        setSelectedModel(prev => (!prev && Object.keys(models).length > 0) ? Object.keys(models)[0] : prev)
      }
    }).catch(console.error)
  }, [setAvailableModels, setSelectedModel])

  useEffect(() => {
    const unsubNew = window.api.on('command:new-conversation', () => { newConversation().catch(console.error) })
    const unsubOpen = window.api.on('command:open-workspace', () => { openWorkspace().catch(console.error) })
    const unsubSidebar = window.api.on('shortcut:toggle-sidebar', () => { setSidebarExpanded(p => !p) })
    const unsubArtifacts = window.api.on('shortcut:toggle-artifacts', () => { setArtifactPanelOpen(p => !p) })
    const unsubFocus = window.api.on('shortcut:focus-input', () => {
      const el = document.querySelector<HTMLElement>('.input-bar-text-area')
      if (el) { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range) }
    })
    const unsubTerminal = window.api.on('shortcut:toggle-terminal', () => {
      setArtifactPanelOpen(true); setArtifactPanelMode('terminal')
    })
    return () => { unsubNew(); unsubOpen(); unsubSidebar(); unsubArtifacts(); unsubFocus(); unsubTerminal() }
  }, [newConversation, openWorkspace, setSidebarExpanded, setArtifactPanelOpen, setArtifactPanelMode])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const handleResize = () => {
      document.body.classList.add('resize-active')
      clearTimeout(timer)
      timer = setTimeout(() => { document.body.classList.remove('resize-active') }, 100)
    }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize); clearTimeout(timer) }
  }, [])



  return (
    <div className={`app-root ${sidebarExpanded ? 'sidebar-is-expanded' : 'sidebar-is-collapsed'} ${isMac ? 'is-mac' : 'is-win'}`}>
      <title>{activeThreadTitle} — Orch Code</title>
      <meta name="description" content="AI pair programming assistant" />
      <Toaster position="bottom-right" theme="dark" toastOptions={{ style: { background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-display)' } }} />
      <TitleBar />
      <div className="app-main-layout">
        <ErrorBoundary name="Sidebar">
          <LeftSidebar />
        </ErrorBoundary>
        <div className="app-content-wrapper">
          <div className="app-container">
            <main className="workspace-main">
              <div className="split-view-container">
                <div className="chat-pane-wrapper">
                  <ErrorBoundary name="Chat Panel">
                    <ChatPane />
                  </ErrorBoundary>
                </div>
                <div className={`artifact-pane-wrapper ${isArtifactPanelOpen ? 'artifact-pane-expanded' : 'artifact-pane-collapsed'}`}>
                  <ErrorBoundary name="Artifacts Panel">
                    <React.Suspense fallback={<div className="editor-loading">Loading Artifacts...</div>}>
                      <ArtifactPanel />
                    </React.Suspense>
                  </ErrorBoundary>
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
      <div className={`fixed-nav-container ${isMac ? 'fixed-nav-mac' : 'fixed-nav-win'}`}>
        <button className="fixed-nav-btn" onClick={() => setSidebarExpanded(!sidebarExpanded)} title={sidebarExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}>
          <PanelLeft size={16} />
        </button>
        <button className="fixed-nav-btn" onClick={() => window.history.back()} title="Back">
          <ArrowLeft size={16} />
        </button>
        <button className="fixed-nav-btn" onClick={() => window.history.forward()} title="Forward">
          <ArrowRight size={16} />
        </button>
      </div>
      <div className={`fixed-right-container ${isMac ? 'fixed-right-mac' : 'fixed-right-win'}`}>
        <button
          onClick={() => setArtifactPanelOpen(!isArtifactPanelOpen)}
          title={isArtifactPanelOpen ? 'Collapse Panel' : 'Expand Panel'}
          className="fixed-toggle-panel-btn"
        >
          <PanelRight size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
function App(): React.JSX.Element {
  const [view] = useState(() => new URLSearchParams(window.location.search).get('view'))
  return view === 'onboarding' ? (
    <>
      <title>Welcome to Orch Code</title>
      <meta name="description" content="AI onboarding setup" />
      <Toaster position="bottom-center" theme="dark" toastOptions={{ style: { background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-display)' } }} />
      <OnboardingView />
    </>
  ) : <Provider><ErrorBoundary><React.Suspense fallback={<div className="editor-loading">Loading Orch Code...</div>}><AppInner /></React.Suspense></ErrorBoundary></Provider>
}

export default App
