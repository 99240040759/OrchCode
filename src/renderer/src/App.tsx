import React, { useState, useEffect } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import TitleBar from './components/TitleBar'
import LeftSidebar from './components/LeftSidebar'
import InputBar from './components/InputBar'
import ChatThread from './components/ChatThread'
import ThreadList from './components/ThreadList'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { ChevronDown, Code } from 'lucide-react'
import { Toaster } from 'sonner'
import {
  activeThreadIdAtom,
  sidebarExpandedAtom,
  activeWorkspaceAtom,
  isArtifactPanelOpenAtom,
  isThreadLoadingAtom,
  activeThreadAtom,
  hasMessagesAtom,
  globalPromptTriggerAtom,
  availableModelsAtom,
  selectedModelAtom,
  authUserAtom
} from './store/agentStore'
import { useAgentStream } from './hooks/useAgentStream'
import { useThreads } from './hooks/useThreads'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'

// ─── Chat Pane ────────────────────────────────────────────────────────────────

interface ChatPaneProps {
  fullWidth: boolean
  onSubmit: (prompt: string, mode?: string, attachments?: any[]) => void
  onStop: () => void
  onOpenArtifacts: () => void
  onOpenWorkspace: () => void
  workspaceName: string
  hasMessages: boolean
}

const ChatPane = React.memo<ChatPaneProps>(
  ({
    fullWidth,
    onSubmit,
    onStop,
    onOpenArtifacts,
    onOpenWorkspace,
    workspaceName,
    hasMessages
  }) => {
    const isLoading = useAtomValue(isThreadLoadingAtom)

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
        <TitleBar title="Orch Code" workspaceName={workspaceName} />

        {/* Thread loading skeleton overlay */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              top: 'var(--titlebar-height)',
              zIndex: 10,
              backgroundColor: 'rgba(18,18,18,0.7)',
              backdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                border: '2px solid var(--border-color)',
                borderTopColor: 'var(--accent-blue)',
                animation: 'spin 0.8s linear infinite'
              }}
            />
          </div>
        )}

        {hasMessages ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              maxWidth: fullWidth ? '720px' : '100%',
              height: 'calc(100% - var(--titlebar-height))',
              minWidth: 0,
              margin: '0 auto',
              flex: 1
            }}
          >
            <ChatThread />
            <div style={{ padding: '0 24px 20px', flexShrink: 0 }}>
              <InputBar onSubmit={onSubmit} onStop={onStop} />
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              width: '100%',
              height: 'calc(100% - var(--titlebar-height))',
              overflowY: 'auto'
            }}
          >
            <div
              className="home-prompt-view"
              style={{ width: '100%', maxWidth: '720px', margin: '0 auto' }}
            >
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
                    onClick={onOpenWorkspace}
                    style={{ margin: 0, gap: 6, cursor: 'pointer' }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>Start new conversation in</span>
                    <ChevronDown
                      size={14}
                      style={{ color: 'var(--text-secondary)', marginTop: 2 }}
                    />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {workspaceName !== 'New Chat' ? workspaceName : 'Select Workspace'}
                    </span>
                  </h2>
                </div>
              )}

              <InputBar onSubmit={onSubmit} onStop={onStop} />

              {fullWidth && (
                <div className="prompt-sub-links" style={{ marginTop: 16, gap: 16 }}>
                  <a
                    href="#"
                    className="prompt-sub-link"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenArtifacts()
                    }}
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
)
ChatPane.displayName = 'ChatPane'

// ─── App Inner ────────────────────────────────────────────────────────────────

function AppInner(): React.JSX.Element {
  const setActiveThreadId = useSetAtom(activeThreadIdAtom)
  const setAvailableModels = useSetAtom(availableModelsAtom)
  const setAuthUser = useSetAtom(authUserAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const hasMessages = useAtomValue(hasMessagesAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const activeThreadTitle = activeThread ? activeThread.title || 'New Chat' : 'New Chat'

  const { run, stop } = useAgentStream()
  const { openWorkspace, newConversation, loadThreads } = useThreads()
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)

  // Global prompt trigger (e.g., from new conversation or keyboard shortcut)
  useEffect(() => {
    if (globalPrompt) {
      run(globalPrompt.prompt, globalPrompt.mode, undefined, globalPrompt.threadId)
      setGlobalPrompt(null)
    }
  }, [globalPrompt, run, setGlobalPrompt])

  // One-time init: conversation ID, threads, models, auth user
  useEffect(() => {
    const init = async () => {
      // Fetch current conversation ID from main process
      const convId = await window.api.getConversationId()
      if (convId) setActiveThreadId(convId)

      // Load thread list
      await loadThreads()

      // Load available models
      try {
        const models = await window.api.getAvailableModels()
        if (models) {
          setAvailableModels(models)
          const modelKeys = Object.keys(models)
          if (!selectedModel && modelKeys.length > 0) {
            setSelectedModel(modelKeys[0])
          }
        }
      } catch (err) {
        console.error('Failed to load available models:', err)
      }

      // Load current auth user (single source — LeftSidebar reads from authUserAtom only)
      try {
        const user = await window.api.getAuthUser()
        setAuthUser(user ?? null)
      } catch {
        setAuthUser(null)
      }
    }

    init()

    // Auth status subscription — runs once globally here, not duplicated in sidebar
    const unsubAuth = window.api.onAuthStatusChanged((user) => {
      setAuthUser(user ?? null)
    })

    return () => {
      unsubAuth()
    }
  }, [setActiveThreadId, loadThreads, setAvailableModels, setAuthUser])

  const workspaceName = activeWorkspace
    ? `${activeWorkspace.name} / ${activeThreadTitle}`
    : activeThreadTitle

  const handlePromptSubmit = (prompt: string, mode?: string, attachments?: any[]) => {
    run(prompt, mode, attachments)
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        position: 'relative',
        width: '100%'
      }}
    >
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

      {sidebarExpanded && (
        <LeftSidebar
          expanded={sidebarExpanded}
          onToggle={(val) => setSidebarExpanded(val)}
          onStartConversation={newConversation}
          threadListContent={<ThreadList />}
        />
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100vh',
          minWidth: 0,
          flex: 1
        }}
      >
        <div className="app-container" style={{ height: '100%', width: '100%', flex: 1 }}>
          <main className="workspace-main" style={{ width: '100%', height: '100%' }}>
            <div className="app-glow-border" />

            {isArtifactPanelOpen ? (
              <PanelGroup
                direction="horizontal"
                className="split-view-container"
                style={{ width: '100%', height: '100%', overflow: 'hidden' }}
              >
                <Panel id="chat-pane-panel" defaultSize={45} minSize={30}>
                  <ChatPane
                    fullWidth={false}
                    onSubmit={handlePromptSubmit}
                    onStop={stop}
                    onOpenArtifacts={() => setArtifactPanelOpen(true)}
                    onOpenWorkspace={openWorkspace}
                    workspaceName={workspaceName}
                    hasMessages={hasMessages}
                  />
                </Panel>
                <PanelResizeHandle className="panel-resize-handle" />
                <Panel id="artifact-panel-panel" defaultSize={55} minSize={35}>
                  <ArtifactPanel />
                </Panel>
              </PanelGroup>
            ) : (
              <ChatPane
                fullWidth={true}
                onSubmit={handlePromptSubmit}
                onStop={stop}
                onOpenArtifacts={() => setArtifactPanelOpen(true)}
                onOpenWorkspace={openWorkspace}
                workspaceName={workspaceName}
                hasMessages={hasMessages}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

function App(): React.JSX.Element {
  const [view] = useState(() => new URLSearchParams(window.location.search).get('view'))

  if (view === 'onboarding') {
    return (
      <>
        <Toaster
          position="bottom-center"
          theme="dark"
          toastOptions={{
            style: {
              background: '#161616',
              border: '1px solid var(--border-color)',
              color: '#f3f3f3',
              fontSize: 13
            }
          }}
        />
        <OnboardingView />
      </>
    )
  }

  return (
    <Provider>
      <AppInner />
    </Provider>
  )
}

export default App
