import React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom, useAtomValue } from 'jotai'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

import type { FileReadResult } from '../../preload/index.d'

interface MarkdownRendererProps { content: string; isArtifact?: boolean }
type CodeChildProps = { className?: string; children?: React.ReactNode }

const extractText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return (node as React.ReactNode[]).map(extractText).join('')
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? extractText(node.props.children) : ''
}

const LocalImage: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const conversationId = useAtomValue(activeThreadIdAtom)
  const [imgSrc, setImgSrc] = React.useState<string | null>(null)
  const [error, setError] = React.useState<boolean>(false)
  const [loading, setLoading] = React.useState<boolean>(true)

  React.useEffect(() => {
    let active = true
    const loadImage = async () => {
      try {
        setLoading(true); setError(false)
        const stripped = src.replace(/^file:\/\/\/?/, '')
        let filePath = decodeURIComponent(stripped)
        if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) filePath = '/' + filePath
        const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as FileReadResult | undefined
        if (active) {
          if (fileData?.isBinary && fileData.base64) setImgSrc(`data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`)
          else setError(true)
        }
      } catch (err) { console.error(err); if (active) setError(true) }
      finally { if (active) setLoading(false) }
    }
    loadImage(); return () => { active = false }
  }, [src, conversationId])

  if (loading) return <div className="local-image-loading-frame"><div className="tool-call-spinner" /><span className="shimmer-text">Loading image...</span></div>
  if (error || !imgSrc) return <div className="local-image-error-frame"><span>Failed to load image</span></div>
  return <div className="local-image-container"><img src={imgSrc} alt={alt || 'Generated Image'} className="local-image-preview" /></div>
}

function useMarkdownComponents() {
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const conversationId = useAtomValue(activeThreadIdAtom)
  const stateRef = React.useRef({ setArtifactPanelOpen, setActiveEditorFile, setArtifactPanelMode, conversationId })
  stateRef.current = { setArtifactPanelOpen, setActiveEditorFile, setArtifactPanelMode, conversationId }

  return React.useMemo(() => ({
    hr: () => null,
    a: ({ href, children, node, ...props }: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) => {
      if (href?.startsWith('file://')) {
        const stripped = href.replace(/^file:\/\/\/?/, '')
        let filePath = decodeURIComponent(stripped)
        if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) filePath = '/' + filePath
        const handleFileClick = async (e: React.MouseEvent) => {
          e.preventDefault()
          try {
            const { setActiveEditorFile: sae, setArtifactPanelMode: spm, setArtifactPanelOpen: sapo, conversationId: cid } = stateRef.current
            const fileData = await window.api.invoke('file:read', { filePath, conversationId: cid }) as FileReadResult | undefined
            if (fileData) { sae(fileData); spm('editor'); sapo(true) }
          } catch (err) { console.error(err) }
        }
        return (
          <span onClick={handleFileClick} title={`Open ${filePath}`} className="file-link">
            <SymbolsFileIcon fileName={filePath.split(/[/\\]/).pop() ?? ''} autoAssign width={14} height={14} className="file-icon-wrapper" />
            <span className="file-name-wrapper">{children}</span>
          </span>
        )
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
    },
    pre: ({ children, node, ...props }: React.ComponentPropsWithoutRef<'pre'> & { node?: unknown }) => {
      const codeChild = React.Children.toArray(children)[0]
      const codeElement = React.isValidElement(codeChild) ? (codeChild as React.ReactElement<CodeChildProps>) : null
      const className = codeElement?.props?.className || ''
      const match = /language-(\w+)/.exec(className), language = match ? match[1] : ''
      const codeString = codeElement?.props?.children ? extractText(codeElement.props.children).replace(/\n$/, '') : ''
      if (language) {
        return (
          <pre className={`${className} pre-wrapper`} {...props}>
            <span className="code-block-lang">{language}</span>
            <button className="code-block-copy-btn" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(codeString); toast.success('Code copied to clipboard') }} title="Copy code">
              <Copy size={13} />
            </button>
            {children}
          </pre>
        )
      }
      return <pre {...props}>{children}</pre>
    },
    code: ({ className, children, node, ...props }: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) => <code className={className} {...props}>{children}</code>,
    img: ({ src, alt, node, ...props }: React.ComponentPropsWithoutRef<'img'> & { node?: unknown }) => (src?.startsWith('file://') || src?.startsWith('/') || src?.match(/^[a-zA-Z]:/)) ? <LocalImage src={src} alt={alt} {...props} /> : <img src={src} alt={alt} {...props} />
  }), [])
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isArtifact = false }) => {
  const components = useMarkdownComponents()
  const processed = React.useMemo(() => content.replace(/(!?\[.*?\])\((.*?)\)/g, (match, label, url) => {
    const clean = url.replace(/\\/g, '/')
    if (!clean.startsWith('file://') && !clean.startsWith('/') && !clean.match(/^[a-zA-Z]:/)) return match
    let fmt = clean.replace(/^file:\/\/\/?/, 'file:///').replace(/^file:\/\/\/([a-zA-Z]:)/, 'file:///$1')
    if (!fmt.startsWith('file:///')) fmt = fmt.startsWith('/') ? 'file://' + fmt : 'file:///' + fmt
    try { fmt = encodeURI(decodeURI(fmt)) } catch { fmt = fmt.replace(/ /g, '%20') }
    return `${label}(${fmt})`
  }), [content])
  return (
    <div className={`markdown-content${isArtifact ? ' markdown-artifact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]} urlTransform={(value) => value} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}

export default React.memo(MarkdownRenderer, (prev, next) => prev.content === next.content && prev.isArtifact === next.isArtifact)
