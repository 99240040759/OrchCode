import React, { useState, useEffect, useRef } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import LeftSidebar from './components/LeftSidebar'
import ThreadList from './components/ThreadList'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { Toaster } from 'sonner'
import {
  sidebarExpandedAtom, activeWorkspaceAtom, isArtifactPanelOpenAtom, activeThreadAtom,
  hasMessagesAtom, globalPromptTriggerAtom, availableModelsAtom, selectedModelAtom, authUserAtom
} from './store/agentStore'
import { useChat } from './hooks/useChat'
import { ChatPane } from './components/ChatPane'
import { authService } from './services/authService'
import { threadService } from './services/services'
import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from 'lucide-react'

const isMac = window.api.platform === 'darwin'

function AppInner(): React.JSX.Element {
  const setAvailableModels = useSetAtom(availableModelsAtom)
  const setAuthUser = useSetAtom(authUserAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const hasMessages = useAtomValue(hasMessagesAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const activeThreadTitle = activeThread?.title || 'New Chat'
  const { run, stop, openWorkspace, newConversation, loadThreads, selectThread } = useChat()
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)
  const availableModels = useAtomValue(availableModelsAtom)
  const sessionInitialized = useRef(false)

  useEffect(() => {
    if (globalPrompt && Object.keys(availableModels).length > 0) { run(globalPrompt.prompt, globalPrompt.mode, undefined, globalPrompt.threadId); setGlobalPrompt(null) }
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
      if (models) { setAvailableModels(models); if (!selectedModel && Object.keys(models).length > 0) setSelectedModel(Object.keys(models)[0]) }
    }).catch(console.error)
  }, [setAvailableModels, setSelectedModel, selectedModel])

  useEffect(() => {
    const unsubNew = window.api.on('command:new-conversation', () => {
      newConversation().catch(console.error)
    })
    const unsubOpen = window.api.on('command:open-workspace', () => {
      openWorkspace().catch(console.error)
    })
    return () => {
      unsubNew()
      unsubOpen()
    }
  }, [newConversation, openWorkspace])

  return (
    <div className="app-root">
      <Toaster position="bottom-right" theme="dark" toastOptions={{ style: { background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-display)' } }} />
      <LeftSidebar expanded={sidebarExpanded} onStartConversation={newConversation} threadListContent={<ThreadList />} />
      <div className="app-content-wrapper">
        <div className="app-container">
          <main className="workspace-main">
            <div className="app-glow-border" />
            <div className="split-view-container">
              <div className="chat-pane-wrapper">
                <ChatPane fullWidth={!isArtifactPanelOpen} onSubmit={(p, m, a) => run(p, m, a)} onStop={stop} onOpenArtifacts={() => setArtifactPanelOpen(true)} onOpenWorkspace={openWorkspace} workspaceName={activeWorkspace ? `${activeWorkspace.name} / ${activeThreadTitle}` : activeThreadTitle} hasMessages={hasMessages} />
              </div>
              <div className={`artifact-pane-wrapper ${isArtifactPanelOpen ? 'artifact-pane-expanded' : 'artifact-pane-collapsed'}`}><ArtifactPanel /></div>
            </div>
          </main>
        </div>
      </div>
      <div className={`app-sidebar-toggle app-region-no-drag ${isMac ? 'app-sidebar-toggle-mac' : 'app-sidebar-toggle-win'}`} onClick={() => setSidebarExpanded(!sidebarExpanded)} title={sidebarExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}>
        {sidebarExpanded ? <PanelLeftClose size={16} strokeWidth={1.5} /> : <PanelLeft size={16} strokeWidth={1.5} />}
      </div>
      <div className={`app-artifact-toggle app-region-no-drag ${isMac ? 'app-artifact-toggle-mac' : 'app-artifact-toggle-win'}`} onClick={() => setArtifactPanelOpen(!isArtifactPanelOpen)} title={isArtifactPanelOpen ? 'Collapse Panel' : 'Expand Panel'}>
        {isArtifactPanelOpen ? <PanelRightClose size={16} strokeWidth={1.5} /> : <PanelRight size={16} strokeWidth={1.5} />}
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const [view] = useState(() => new URLSearchParams(window.location.search).get('view'))
  return view === 'onboarding' ? (
    <>
      <Toaster position="bottom-center" theme="dark" toastOptions={{ style: { background: '#161616', border: '1px solid var(--border-color)', color: '#f3f3f3', fontSize: 13 } }} />
      <OnboardingView />
    </>
  ) : <Provider><AppInner /></Provider>
}

export default App
