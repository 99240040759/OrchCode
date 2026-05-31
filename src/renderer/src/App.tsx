import React, { useEffect } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import TitleBar from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import RightSidebar from './components/RightSidebar'
import InputBar from './components/InputBar'
import ChatThread from './components/ChatThread'
import ThreadList from './components/ThreadList'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { ChevronDown, Code, Inbox } from 'lucide-react'
import { Toaster } from 'sonner'
import {
  conversationIdAtom,
  sidebarExpandedAtom,
  activeWorkspaceAtom,
  isArtifactPanelOpenAtom,
  activeThreadAtom,
  hasMessagesAtom,
  globalPromptTriggerAtom,
  availableModelsAtom
} from './store/agentStore'
import { useAgentStream } from './hooks/useAgentStream'
import { useThreads } from './hooks/useThreads'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

function AppInner(): React.JSX.Element {
  const setConversationId = useSetAtom(conversationIdAtom)
  const setAvailableModels = useSetAtom(availableModelsAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const hasMessages = useAtomValue(hasMessagesAtom)
  const conversationId = useAtomValue(conversationIdAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeThreadTitle = activeThread ? (activeThread.title || 'New Chat') : 'New Chat'

  const { run, stop } = useAgentStream()

  const { openWorkspace, newConversation, loadThreads } = useThreads()
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)

  useEffect(() => {
    if (globalPrompt) {
      run(globalPrompt.prompt, globalPrompt.mode)
      setGlobalPrompt(null)
    }
  }, [globalPrompt, run, setGlobalPrompt])

  useEffect(() => {
    const init = async () => {
      const convId = await window.api.getConversationId()
      if (convId) setConversationId(convId)
      await loadThreads()
      try {
        const models = await window.api.getAvailableModels()
        if (models) setAvailableModels(models)
      } catch (err) {
        console.error('Failed to load available models:', err)
      }
    }
    init()
  }, [setConversationId, loadThreads, setAvailableModels])

  const handleOpenWorkspace = () => { openWorkspace() }
  const handleStartConversation = () => { newConversation() }
  const handlePromptSubmit = (prompt: string, mode?: string, attachments?: any[]) => { run(prompt, mode, attachments) }

  const renderChatPane = (fullWidth: boolean) => {
    return (
      <div
        className="chat-pane"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          position: 'relative',
          contain: 'layout'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '38px',
            padding: '0 16px',
            backgroundColor: '#1e1e1e',
            borderBottom: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            fontWeight: 500,
            flexShrink: 0
          }}
        >
          {activeWorkspace ? activeWorkspace.name : 'Select Workspace'} / {activeThreadTitle}
        </div>

        {hasMessages ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: fullWidth ? '720px' : '100%',
            height: 'calc(100% - 38px)',
            minWidth: 0,
            margin: '0 auto',
            flex: 1
          }}>
            <ChatThread />
            <div style={{ padding: '0 24px 20px', flexShrink: 0 }}>
              <InputBar onSubmit={handlePromptSubmit} onStop={stop} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: 'calc(100% - 38px)', overflowY: 'auto' }}>
            <div className="home-prompt-view" style={{ width: '100%', maxWidth: '720px', margin: '0 auto' }}>
              {fullWidth && (
                <div
                  className="home-prompt-header"
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-end',
                    marginBottom: 12
                  }}
                >
                  <h2
                    className="home-prompt-title"
                    onClick={handleOpenWorkspace}
                    style={{ fontSize: 16, margin: 0, gap: 6, fontWeight: 500 }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>Start new conversation in</span>
                    <ChevronDown size={14} style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
                    <span style={{ color: '#e5e5e5', fontWeight: 600 }}>
                      {activeWorkspace ? activeWorkspace.name : 'Select Workspace'}
                    </span>
                  </h2>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--text-secondary)',
                      fontSize: 13,
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    <Inbox size={14} strokeWidth={2} />
                    <span>View Inbox</span>
                  </div>
                </div>
              )}

              <InputBar onSubmit={handlePromptSubmit} onStop={stop} />

              {fullWidth && (
                <div className="prompt-sub-links" style={{ marginTop: 16, gap: 16 }}>
                  <a
                    href="#"
                    className="prompt-sub-link"
                    onClick={(e) => {
                      e.preventDefault()
                      setArtifactPanelOpen(true)
                    }}
                    style={{ fontSize: 12.5, fontWeight: 500 }}
                  >
                    <Code size={14} strokeWidth={2} />
                    <span>Open editor</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>

      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--bg-sidebar)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'var(--font-display)'
          }
        }}
      />

      <TitleBar
        title="Orch Code"
        workspaceName={activeWorkspace?.name}
        onOpenEditor={() => setArtifactPanelOpen(!isArtifactPanelOpen)}
        onSettingsClick={() => {}}
      />

      <div className="app-container">
        <LeftSidebar
          expanded={sidebarExpanded}
          onToggle={(val) => setSidebarExpanded(val)}
          onStartConversation={handleStartConversation}
          onFooterItemClick={() => {}}
          threadListContent={<ThreadList />}
        />

        <main className="workspace-main">

          <div className="app-glow-border" />

          {isArtifactPanelOpen ? (
            <PanelGroup direction="horizontal" className="split-view-container" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
              <Panel id="chat-pane-panel" defaultSize={45} minSize={30}>
                {renderChatPane(false)}
              </Panel>
              <PanelResizeHandle className="panel-resize-handle" />
              <Panel id="artifact-panel-panel" defaultSize={55} minSize={35}>
                <ArtifactPanel />
              </Panel>
            </PanelGroup>
          ) : (
            renderChatPane(true)
          )}
        </main>

        <RightSidebar conversationId={conversationId} />
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')

  if (view === 'onboarding') {
    return <OnboardingView />
  }

  return (
    <Provider>
      <AppInner />
    </Provider>
  )
}

export default App
