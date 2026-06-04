import React, { useState, useEffect } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import LeftSidebar from './components/LeftSidebar'
import ThreadList from './components/ThreadList'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { Toaster } from 'sonner'
import {
  activeThreadIdAtom,
  sidebarExpandedAtom,
  activeWorkspaceAtom,
  isArtifactPanelOpenAtom,
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
import { ChatPane } from './components/ChatPane'
import { authService } from './services/authService'
import { threadService } from './services/threadService'

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
  const { openWorkspace, newConversation, loadThreads, selectThread } = useThreads()
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)
  const availableModels = useAtomValue(availableModelsAtom)

  // Global prompt trigger (e.g., from new conversation or keyboard shortcut)
  useEffect(() => {
    if (globalPrompt && Object.keys(availableModels).length > 0) {
      run(globalPrompt.prompt, globalPrompt.mode, undefined, globalPrompt.threadId)
      setGlobalPrompt(null)
    }
  }, [globalPrompt, run, setGlobalPrompt, availableModels])

  // One-time init: conversation ID, threads, models, auth user
  useEffect(() => {
    const init = async () => {
      // Fetch current conversation ID from main process
      const convId = await threadService.getConversationId()
      if (convId) {
        await selectThread(convId)
      }

      // Load thread list
      await loadThreads()

      // Load available models
      try {
        const models = await window.agentBridge.getAvailableModels()
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

      // Load current auth user
      try {
        const user = await authService.getAuthUser()
        setAuthUser(user ?? null)
      } catch {
        setAuthUser(null)
      }
    }

    init()

    // Auth status subscription
    const unsubAuth = authService.onAuthStatusChanged((user) => {
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
    <div className="app-root">
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

      <div className="app-content-wrapper">
        <div className="app-container">
          <main className="workspace-main">
            <div className="app-glow-border" />

            {isArtifactPanelOpen ? (
              <PanelGroup
                direction="horizontal"
                className="split-view-container"
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
