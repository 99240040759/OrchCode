import React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom, useAtomValue } from 'jotai'
import {
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  artifactPanelModeAtom,
  conversationIdAtom
} from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import './MarkdownRenderer.css'

interface MarkdownRendererProps {
  content: string
  isArtifact?: boolean
}

type CodeChildProps = { className?: string; children?: React.ReactNode }

function extractText(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement<{ children?: any }>(node)) return extractText(node.props.children)
  return ''
}

function useMarkdownComponents(isArtifact: boolean) {
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const conversationId = useAtomValue(conversationIdAtom)

  const stateRef = React.useRef({
    setArtifactPanelOpen,
    setActiveEditorFile,
    setArtifactPanelMode,
    conversationId
  })
  stateRef.current = {
    setArtifactPanelOpen,
    setActiveEditorFile,
    setArtifactPanelMode,
    conversationId
  }

  return React.useMemo(
    () => ({
      hr: () => null,
      a: ({ href, children, ...props }: any) => {
        if (href && href.startsWith('file://')) {
          const stripped = href.replace(/^file:\/\/\/?/, '')
          let filePath = decodeURIComponent(stripped)
          if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) {
            filePath = '/' + filePath
          }

          const handleFileClick = async (e: React.MouseEvent) => {
            e.preventDefault()
            try {
              const {
                setActiveEditorFile: sae,
                setArtifactPanelMode: spm,
                setArtifactPanelOpen: sapo,
                conversationId: cid
              } = stateRef.current
              const fileData = await window.api.readFile(filePath, cid)
              if (fileData) {
                sae(fileData)
                spm('editor')
                sapo(true)
              }
            } catch (err) {
              console.error('[MarkdownRenderer] Failed to open file:', err)
            }
          }

          const filename = filePath.split(/[/\\]/).pop() ?? ''
          return (
            <span
              onClick={handleFileClick}
              title={`Open ${filePath}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                userSelect: 'none',
                cursor: 'pointer',
                margin: '0 2px',
                verticalAlign: 'middle'
              }}
            >
              <SymbolsFileIcon
                fileName={filename}
                autoAssign={true}
                width={14}
                height={14}
                style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
              />
              <span
                style={{
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '13px'
                }}
              >
                {children}
              </span>
            </span>
          )
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        )
      },
      pre: ({ children, ...props }: any) => {
        const codeChild = React.Children.toArray(children)[0]
        const codeElement = React.isValidElement(codeChild)
          ? (codeChild as React.ReactElement<CodeChildProps>)
          : null
        const className = codeElement?.props?.className || ''
        const match = /language-(\w+)/.exec(className)
        const language = match ? match[1] : ''

        const codeString = codeElement?.props?.children
          ? extractText(codeElement.props.children).replace(/\n$/, '')
          : ''

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
      code: ({ className, children, ...props }: any) => (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }),
    [isArtifact]
  )
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isArtifact = false }) => {
  const components = useMarkdownComponents(isArtifact)

  return (
    <div className={`markdown-content ${isArtifact ? 'is-artifact' : 'is-chat'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        urlTransform={(value) => value}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default React.memo(MarkdownRenderer, (prev, next) => {
  return prev.content === next.content && prev.isArtifact === next.isArtifact
})
