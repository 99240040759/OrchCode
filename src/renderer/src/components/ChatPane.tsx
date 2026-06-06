import React from 'react'
import { useAtomValue } from 'jotai'
import { ChevronDown, Code } from 'lucide-react'
import TitleBar from './TitleBar'
import Lottie from 'lottie-react'
import emptyStateAnimation from '../assets/empty-state.json'
import InputBar from './InputBar'
import ChatThread from './ChatThread'
import { isThreadLoadingAtom } from '../store/agentStore'

interface ChatPaneProps {
  fullWidth: boolean
  onSubmit: (prompt: string, mode?: string, attachments?: any[]) => void
  onStop: () => void
  onOpenArtifacts: () => void
  onOpenWorkspace: () => void
  workspaceName: string
  hasMessages: boolean
}

export const ChatPane = React.memo<ChatPaneProps>(
  ({ fullWidth, onSubmit, onStop, onOpenArtifacts, onOpenWorkspace, workspaceName, hasMessages }) => {
    const isLoading = useAtomValue(isThreadLoadingAtom)

    return (
      <div className="chat-pane-root">
        <TitleBar title="Orch Code" workspaceName={workspaceName} />

        {isLoading && (
          <div className="thread-loading-overlay">
            <div className="thread-loading-spinner" />
          </div>
        )}

        {hasMessages ? (
          <div className={`chat-pane-content${fullWidth ? ' chat-pane-content-full-width' : ''}`}>
            <ChatThread />
            <div className="chat-pane-input">
              <InputBar onSubmit={onSubmit} onStop={onStop} />
            </div>
          </div>
        ) : (
          <div className="chat-pane-empty">
            <div className="home-prompt-view">
              <div className="chat-pane-content-full-width">
                <div className="home-prompt-header">
                  <h2 className="home-prompt-title" onClick={onOpenWorkspace}>
                    <span className="text-primary">Start new conversation in</span>
                    <ChevronDown size={14} className="home-prompt-chevron" />
                    <span className="text-primary font-semibold">
                      {workspaceName !== 'New Chat' ? workspaceName : 'Select Workspace'}
                    </span>
                  </h2>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: 220, marginBottom: 12 }}>
                  <Lottie
                    animationData={emptyStateAnimation}
                    loop={true}
                    style={{ width: 220, height: 220 }}
                  />
                </div>
                <InputBar onSubmit={onSubmit} onStop={onStop} />

                {fullWidth && (
                  <div className="prompt-sub-links">
                    <a href="#" className="prompt-sub-link" onClick={(e) => { e.preventDefault(); onOpenArtifacts() }}>
                      <Code size={14} strokeWidth={2} />
                      <span>Open editor</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
)
ChatPane.displayName = 'ChatPane'
