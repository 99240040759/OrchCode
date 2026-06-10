import React from 'react'
import { useAtomValue } from 'jotai'
import { ChevronDown, Code, Loader } from 'lucide-react'
import TitleBar from './TitleBar'
import Lottie from 'lottie-react'
import emptyStateAnimation from '../assets/empty-state.json'
import InputBar from './InputBar'
import ChatThread from './ChatThread'
import { isThreadLoadingAtom } from '../store/agentStore'

interface ChatPaneProps {
  fullWidth: boolean
  onSubmit: (prompt: string, attachments?: any[]) => void
  onStop: () => void
  onOpenArtifacts: () => void
  onOpenWorkspace: () => void
  workspaceName: string
  hasMessages: boolean
}

export const ChatPane: React.FC<ChatPaneProps> = ({ fullWidth, onSubmit, onStop, onOpenArtifacts, onOpenWorkspace, workspaceName, hasMessages }) => {
    const isLoading = useAtomValue(isThreadLoadingAtom)

    return (
      <div className="chat-pane-root">
        <TitleBar title="Orch Code" workspaceName={workspaceName} />

        {isLoading && (
          <div className="thread-loading-overlay">
            <Loader className="animate-spin" size={24} style={{ color: 'var(--accent-blue)' }} />
          </div>
        )}

        <div className={`chat-pane-content${fullWidth ? ' chat-pane-content-full-width' : ''} ${hasMessages ? 'chat-state' : 'home-state'}`}>
          <div className="home-hero-section">
            <div className="home-lottie-container">
              <Lottie
                animationData={emptyStateAnimation}
                loop={true}
                className="home-lottie"
              />
            </div>
          </div>

          <div className="home-title-section">
            <div className="home-prompt-header-wrapper">
              <h2 className="home-prompt-title" onClick={onOpenWorkspace}>
                <span className="text-primary">Start new conversation in</span>
                <ChevronDown size={14} className="home-prompt-chevron" />
                <span className="text-primary font-semibold">
                  {workspaceName !== 'New Chat' ? workspaceName : 'Select Workspace'}
                </span>
              </h2>
            </div>
          </div>

          <div className="chat-thread-wrapper">
            <ChatThread />
          </div>

          <div className="chat-pane-input">
            <InputBar onSubmit={onSubmit} onStop={onStop} />
          </div>

          <div className="home-footer-section">
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
    )
}
