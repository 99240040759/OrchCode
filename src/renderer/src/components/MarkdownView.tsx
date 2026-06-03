import React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { globalPromptTriggerAtom } from '../store/agentStore'
import MarkdownRenderer from './MarkdownRenderer'

interface MarkdownViewProps {
  displayFile: {
    name: string
    path: string
    content?: string
  }
  activeWorkspace: { path: string } | null
  isAgentArtifact: (name: string) => boolean
  getArtifactIcon: (name: string) => React.ReactNode
  getDisplayName: (name: string) => string
  getRelativeDirPath: (filePath: string, workspacePath?: string) => string
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  displayFile,
  activeWorkspace,
  isAgentArtifact,
  getArtifactIcon,
  getDisplayName,
  getRelativeDirPath
}) => {
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        flex: 1
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '34px',
          padding: '0 16px',
          backgroundColor: 'var(--bg-app)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}
        >
          {isAgentArtifact(displayFile.name) ? (
            getArtifactIcon(displayFile.name)
          ) : (
            <SymbolsFileIcon
              fileName={displayFile.name}
              autoAssign={true}
              width={16}
              height={16}
              style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
            />
          )}
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              fontSize: 'var(--font-size-sm)',
              whiteSpace: 'nowrap'
            }}
          >
            {getDisplayName(displayFile.name)}
          </span>
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-xs)',
              marginLeft: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          {displayFile.name === 'implementation_plan.md' && (
            <div style={{ display: 'flex', gap: 6, marginRight: '8px' }}>
              <button
                className="btn"
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--font-size-xxs)',
                  height: '22px',
                  border: '1px solid rgba(255,255,255,0.12)'
                }}
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
                className="btn primary"
                style={{
                  padding: '2px 8px',
                  fontSize: 'var(--font-size-xxs)',
                  height: '22px'
                }}
                onClick={() => {
                  setGlobalPrompt({
                    prompt:
                      'I approve the implementation plan. Please proceed with execution.'
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
            className="editor-toolbar-action"
          >
            <Copy size={13} />
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px',
          backgroundColor: 'var(--bg-app)',
          color: 'var(--text-primary)',
          lineHeight: 1.6,
          fontSize: 'var(--font-size-md-plus)',
          userSelect: 'text'
        }}
        className="assistant-content markdown-body"
      >
        <MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} />
      </div>
    </div>
  )
}
export default MarkdownView
