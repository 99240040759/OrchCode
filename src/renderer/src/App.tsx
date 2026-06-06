import React, { useState, useEffect, useRef } from 'react'
import { Provider, useAtom, useSetAtom, useAtomValue } from 'jotai'
import LeftSidebar from './components/LeftSidebar'
import ThreadList from './components/ThreadList'
import ArtifactPanel from './components/ArtifactPanel'
import { OnboardingView } from './components/OnboardingView'
import { Toaster } from 'sonner'
import {
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
import { threadService } from './services/services'

// ─── App Inner ────────────────────────────────────────────────────────────────

function AppInner(): React.JSX.Element {
  const setAvailableModels = useSetAtom(availableModelsAtom)
  const setAuthUser = useSetAtom(authUserAtom)
  const [sidebarExpanded, setSidebarExpanded] = useAtom(sidebarExpandedAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const hasMessages = useAtomValue(hasMessagesAtom)
  const [isArtifactPanelOpen, setArtifactPanelOpen] = useAtom(isArtifactPanelOpenAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  // C-3 FIX: Use separate atoms for read/write to avoid subscribing AppInner to selectedModel changes
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const activeThreadTitle = activeThread ? activeThread.title || 'New Chat' : 'New Chat'

  const { run, stop } = useAgentStream()
  const { openWorkspace, newConversation, loadThreads, selectThread } = useThreads()
  const [globalPrompt, setGlobalPrompt] = useAtom(globalPromptTriggerAtom)
  const availableModels = useAtomValue(availableModelsAtom)

  // C-6 FIX: Guard against double-fire of session init
  const sessionInitialized = useRef(false)

  // Global prompt trigger (e.g., from new conversation or keyboard shortcut)
  useEffect(() => {
    if (globalPrompt && Object.keys(availableModels).length > 0) {
      run(globalPrompt.prompt, globalPrompt.mode, undefined, globalPrompt.threadId)
      setGlobalPrompt(null)
    }
  }, [globalPrompt, run, setGlobalPrompt, availableModels])

  // Auth state loader/subscription
  useEffect(() => {
    const initAuth = async () => {
      try {
        const user = await authService.getAuthUser()
        setAuthUser(user ?? null)
      } catch {
        setAuthUser(null)
      }
    }

    initAuth()

    const unsubAuth = authService.onAuthStatusChanged((user) => {
      setAuthUser(user ?? null)
    })

    return () => {
      unsubAuth()
    }
  }, [setAuthUser])

  // C-6 FIX: Threads & Session Selection — guarded with ref to prevent double-init
  useEffect(() => {
    if (sessionInitialized.current) return
    sessionInitialized.current = true

    const initSession = async () => {
      try {
        const convId = await threadService.getConversationId()
        if (convId) {
          await selectThread(convId)
        }
      } catch (err) {
        console.error('Failed to select initial thread:', err)
      }
      try {
        await loadThreads()
      } catch (err) {
        console.error('Failed to load threads list:', err)
      }
    }

    initSession()
  }, [selectThread, loadThreads])

  // Models Loader — runs once on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await window.api.invoke('models:list') as Record<string, { id: string; name: string }> | null
        if (models) {
          setAvailableModels(models)
          const modelKeys = Object.keys(models)
          // A-3 FIX: Read selectedModel value directly instead of subscribing via useAtom
          if (!selectedModel && modelKeys.length > 0) {
            setSelectedModel(modelKeys[0])
          }
        }
      } catch (err) {
        console.error('Failed to load available models:', err)
      }
    }

    loadModels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAvailableModels, setSelectedModel])

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

            {/*
              C-1 FIX: Instead of conditionally rendering two completely different JSX subtrees
              (which hard-remounts ChatPane on every panel toggle causing "massive flashes"),
              we ALWAYS render PanelGroup with ChatPane mounted.
              The artifact panel is hidden via CSS when closed — no unmount/remount occurs.
            */}
            <PanelGroup
              direction="horizontal"
              className="split-view-container"
            >
              <Panel
                id="chat-pane-panel"
                defaultSize={isArtifactPanelOpen ? 45 : 100}
                minSize={30}
              >
                <ChatPane
                  fullWidth={!isArtifactPanelOpen}
                  onSubmit={handlePromptSubmit}
                  onStop={stop}
                  onOpenArtifacts={() => setArtifactPanelOpen(true)}
                  onOpenWorkspace={openWorkspace}
                  workspaceName={workspaceName}
                  hasMessages={hasMessages}
                />
              </Panel>

              {isArtifactPanelOpen && (
                <>
                  <PanelResizeHandle className="panel-resize-handle" />
                  <Panel id="artifact-panel-panel" defaultSize={55} minSize={35}>
                    <ArtifactPanel />
                  </Panel>
                </>
              )}
            </PanelGroup>
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
