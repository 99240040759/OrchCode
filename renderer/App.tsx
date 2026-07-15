import React, { useState } from 'react'
import '@fontsource/sora'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { ArtifactPanel } from './components/ArtifactPanel'
import { SearchPanel } from './components/SearchPanel'
import { Onboarding } from './components/Onboarding'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useThreadStore } from './lib/threadStore'
import { useAuthStore } from './lib/authStore'
import { TooltipProvider } from './components/tooltip'
import logo from './assets/logo.png'
import { useShallow } from 'zustand/react/shallow'
import { TbLoader2 } from 'react-icons/tb'

const ContentArea = React.memo(function ContentArea({
  activeNav
}: {
  activeNav: 'new' | 'Search' | undefined
}) {
  if (activeNav === 'Search') return <SearchPanel />
  return <ChatPanel />
})

export default function App(): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen')
    return saved !== null ? saved === 'true' : true
  })
  React.useEffect(() => {
    localStorage.setItem('sidebarOpen', String(sidebarOpen))
  }, [sidebarOpen])
  const { artifactOpen, setArtifactOpen, activeNav, init, reset } = useThreadStore(
    useShallow((s) => ({
      artifactOpen: s.artifactOpen,
      setArtifactOpen: s.setArtifactOpen,
      activeNav: s.activeNav,
      init: s.init,
      reset: s.reset
    }))
  )
  const {
    session,
    initialized: authInitialized,
    init: initAuth
  } = useAuthStore(
    useShallow((s) => ({
      session: s.session,
      initialized: s.initialized,
      init: s.init
    }))
  )

  React.useEffect(() => {
    initAuth()
  }, [initAuth])

  const hasSession = !!session
  React.useEffect(() => {
    if (!authInitialized) return
    if (hasSession) {
      init()
    } else {
      reset()
    }
  }, [authInitialized, hasSession, init, reset])

  if (!authInitialized)
    return (
      <div className="flex flex-col h-screen bg-black text-tx-main overflow-hidden select-none relative">
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <img src={logo} className="w-12 h-12 opacity-80" alt="" />
          <TbLoader2 size={32} className="text-tx-sub animate-spin" />
          <span className="text-sm text-tx-muted font-medium">Initializing Orch...</span>
        </div>
      </div>
    )

  if (!session)
    return (
      <div className="flex h-screen bg-black text-tx-main overflow-hidden select-none relative">
        <TitleBar />
        <Onboarding />
      </div>
    )

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-black text-tx-main overflow-hidden select-none relative">
        <TitleBar
          sidebarOpen={sidebarOpen}
          artifactOpen={artifactOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onToggleArtifact={() => setArtifactOpen(!artifactOpen)}
        />
        <div className="flex-1 flex gap-1 w-full overflow-hidden p-1 min-h-0">
          <div
            className={
              sidebarOpen
                ? 'z-0 flex-shrink-0 rounded-lg overflow-hidden border border-oc-border shadow-lg bg-oc-surface flex flex-col'
                : 'hidden'
            }
          >
            <div className="h-titlebar w-full flex-shrink-0 pointer-events-none" />
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <ErrorBoundary
                fallback={({ reset }) => (
                  <div className="p-4 text-xs text-destructive text-center">
                    <p className="mb-2">Sidebar crashed</p>
                    <button
                      onClick={reset}
                      className="px-2 py-1 bg-oc-raised rounded border border-oc-border hover:bg-oc-hover cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                )}
              >
                <Sidebar />
              </ErrorBoundary>
            </div>
          </div>
          <PanelGroup direction="horizontal" className="flex-1 z-0" autoSaveId="orch-layout">
            <Panel id="main-panel" order={1} defaultSize={artifactOpen ? 60 : 100} minSize={30}>
              <div className="h-full flex flex-col min-w-0 rounded-lg overflow-hidden border border-oc-border shadow-lg bg-oc-base relative">
                <div className="h-titlebar w-full flex-shrink-0 pointer-events-none" />
                <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
                  <ErrorBoundary
                    fallback={({ error, reset }) => (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-tx-main">
                        <p className="text-destructive font-semibold mb-2">Panel crashed</p>
                        <p className="text-xs text-tx-sub mb-4">{error.message}</p>
                        <button
                          onClick={reset}
                          className="px-3 py-1.5 bg-oc-raised rounded border border-oc-border hover:bg-oc-hover cursor-pointer text-xs font-medium"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  >
                    <ContentArea activeNav={activeNav} />
                  </ErrorBoundary>
                </div>
              </div>
            </Panel>
            {artifactOpen && (
              <>
                <PanelResizeHandle className="w-1 flex-shrink-0 flex justify-center items-center cursor-col-resize group z-10">
                  <div className="w-1 h-8 rounded-full bg-oc-border group-hover:bg-oc-active transition-colors" />
                </PanelResizeHandle>
                <Panel id="artifact-panel" order={2} defaultSize={40} minSize={20}>
                  <div className="h-full rounded-lg overflow-hidden border border-oc-border shadow-lg bg-oc-base flex flex-col relative z-0">
                    <ErrorBoundary
                      fallback={({ error, reset }) => (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-tx-main">
                          <p className="text-destructive font-semibold mb-2">
                            Artifact Panel crashed
                          </p>
                          <p className="text-xs text-tx-sub mb-4">{error.message}</p>
                          <button
                            onClick={reset}
                            className="px-3 py-1.5 bg-oc-raised rounded border border-oc-border hover:bg-oc-hover cursor-pointer text-xs font-medium"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    >
                      <ArtifactPanel onClose={() => setArtifactOpen(false)} />
                    </ErrorBoundary>
                  </div>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      </div>
    </TooltipProvider>
  )
}
