import React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom, useAtomValue } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, conversationIdAtom } from '../store/agentStore'

interface MarkdownRendererProps {
  content: string
  isArtifact?: boolean
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isArtifact = false }) => {
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const conversationId = useAtomValue(conversationIdAtom)

  return (
    <div className={`markdown-content ${isArtifact ? 'is-artifact' : 'is-chat'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          a: ({ href, children, ...props }) => {
            if (href && href.startsWith('file://')) {
              let filePath = decodeURIComponent(href.replace(/^file:\/\/\/?/, ''))
              // If it's a Unix absolute path, prepend leading slash back
              if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) {
                filePath = '/' + filePath
              }

              const handleFileClick = async (e: React.MouseEvent) => {
                e.preventDefault()
                try {
                  const fileData = await window.api.readFile(filePath, conversationId)
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
          },
          pre: ({ children, ...props }) => {
            const codeChild = React.Children.toArray(children)[0] as React.ReactElement
            const className = codeChild?.props?.className || ''
            const match = /language-(\w+)/.exec(className)
            const language = match ? match[1] : ''
            const codeString = codeChild?.props?.children ? String(codeChild.props.children).replace(/\n$/, '') : ''

            if (language) {
              return (
                <pre className={className} {...props} style={{ position: 'relative' }}>
                  <span className="code-block-lang">{language}</span>
                  <button
                    className="code-block-copy-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      navigator.clipboard.writeText(codeString)
                      toast.success('Code copied to clipboard')
                    }}
                    title="Copy code"
                  >
                    <Copy size={13} />
                  </button>
                  {children}
                </pre>
              )
            }

            return <pre {...props}>{children}</pre>
          },
          code: ({ inline, className, children, ...props }) => {
            return (
              <code className={className} {...props}>
                {children}
              </code>
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
