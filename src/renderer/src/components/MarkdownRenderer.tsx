import React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { useSetAtom } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom } from '../store/agentStore'

interface MarkdownRendererProps {
  content: string
  isArtifact?: boolean
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isArtifact = false }) => {
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  return (
    <div className={`markdown-content ${isArtifact ? 'is-artifact' : 'is-chat'}`}>
      <ReactMarkdown
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href && href.startsWith('file://')) {
              const filePath = decodeURIComponent(href.replace(/^file:\/\/\/?/, '/'))

              const handleFileClick = async (e: React.MouseEvent) => {
                e.preventDefault()
                try {
                  const fileData = await window.api.readFile(filePath)
                  if (fileData) {
                    setActiveEditorFile(fileData)
                    setArtifactPanelMode('editor')
                    setArtifactPanelOpen(true)
                  }
                } catch (err) {
                  console.error('[MarkdownRenderer] Failed to open file:', err)
                }
              }

              return (
                <a
                  href={href}
                  onClick={handleFileClick}
                  title={`Open ${filePath}`}
                  {...props}
                >
                  {children}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
