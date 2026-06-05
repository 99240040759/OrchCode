import React from 'react'
import { useAtomValue } from 'jotai'
import { ChevronDown, Code } from 'lucide-react'
import TitleBar from './TitleBar'
import InputBar from './InputBar'
import ChatThread from './ChatThread'
import { isThreadLoadingAtom } from '../store/agentStore'
import * as styles from './chat.css'

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
      <div className={styles.chatPaneRoot}>
        <TitleBar title="Orch Code" workspaceName={workspaceName} />

        {/* Thread loading skeleton overlay */}
        {isLoading && (
          <div className="thread-loading-overlay">
            <div className="thread-loading-spinner" />
          </div>
        )}

        {hasMessages ? (
          <div className={`${styles.chatPaneContent} ${fullWidth ? styles.chatPaneContentFullWidth : ''}`}>
            <ChatThread />
            <div className={styles.chatPaneInput}>
              <InputBar onSubmit={onSubmit} onStop={onStop} />
            </div>
          </div>
        ) : (
          <div className={styles.chatPaneEmpty}>
            <div className={styles.homePromptView}>
              <div className={styles.chatPaneContentFullWidth}>
                <div className={styles.homePromptHeader}>
                  <h2 className={styles.homePromptTitle} onClick={onOpenWorkspace}>
                    <span className="text-primary">Start new conversation in</span>
                    <ChevronDown size={14} className={styles.homePromptChevron} />
                    <span className="text-primary font-semibold">
                      {workspaceName !== 'New Chat' ? workspaceName : 'Select Workspace'}
                    </span>
                  </h2>
                </div>
                <InputBar onSubmit={onSubmit} onStop={onStop} />

                {fullWidth && (
                  <div className={styles.promptSubLinks}>
                    <a href="#" className={styles.promptSubLink} onClick={(e) => { e.preventDefault(); onOpenArtifacts() }}>
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
