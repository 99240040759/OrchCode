import React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { globalPromptTriggerAtom } from '../store/agentStore'
import {
  isAgentArtifact,
  getArtifactIcon,
  getDisplayName,
  getRelativeDirPath
} from '../lib/uiUtils'
import MarkdownRenderer from './MarkdownRenderer'
import * as styles from './editor.css'

interface MarkdownViewProps {
  displayFile: {
    name: string
    path: string
    content?: string
  }
  activeWorkspace: { path: string } | null
}

const MarkdownView: React.FC<MarkdownViewProps> = ({ displayFile, activeWorkspace }) => {
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.fileInfoContainer}>
          {isAgentArtifact(displayFile.name) ? (
            getArtifactIcon(displayFile.name)
          ) : (
            <SymbolsFileIcon
              fileName={displayFile.name}
              autoAssign={true}
              width={16}
              height={16}
              className={styles.fileIcon}
            />
          )}
          <span className={styles.fileName}>{getDisplayName(displayFile.name)}</span>
          <span className={styles.fileDir}>
            {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
          </span>
        </div>

        <div className={styles.toolbarGroup}>
          {displayFile.name === 'implementation_plan.md' && (
            <div className={styles.actionButtonGroup}>
              <button
                className={styles.rejectBtn}
                onClick={() => {
                  setGlobalPrompt({
                    prompt:
                      'I reject the implementation plan. Please make modifications based on my requirements.'
                  })
                  toast.info('Rejected implementation plan. Agent notified.')
                }}
              >
                Reject
              </button>
              <button
                className={styles.proceedBtn}
                onClick={() => {
                  setGlobalPrompt({
                    prompt: 'I approve the implementation plan. Please proceed with execution.'
                  })
                  toast.success('Approved plan. Proceeding with execution.')
                }}
              >
                Proceed
              </button>
            </div>
          )}

          <div
            title="Copy file content"
            onClick={() => {
              navigator.clipboard.writeText(displayFile.content ?? '')
              toast.success('File content copied!')
            }}
            className={styles.editorToolbarAction}
          >
            <Copy size={13} />
          </div>
        </div>
      </div>

      <div className={`assistant-content ${styles.contentContainer}`}>
        <MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} />
      </div>
    </div>
  )
}
export default MarkdownView
