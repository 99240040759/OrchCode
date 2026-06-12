import React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { Copy, Check, Folder } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { globalPromptTriggerAtom, isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom, isDiffModeAtom } from '../store/agentStore'
import { isAgentArtifact, getArtifactIcon, getDisplayName, getRelativeDirPath } from '../lib/uiUtils'
import { toast } from 'sonner'
import mermaid from 'mermaid'
import { stripFileProtocol, normalizeMarkdownLinks } from '../lib/pathUtils'
import type { FileReadResult } from '../../preload/index.d'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import hljs from 'highlight.js'

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', flowchart: { useMaxWidth: true, htmlLabels: true } })

interface MarkdownRendererProps { content: string; isArtifact?: boolean; id?: string; isStreaming?: boolean; ref?: React.Ref<HTMLDivElement> }

const FileLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => {
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const setIsDiffMode = useSetAtom(isDiffModeAtom)
  const conversationId = useAtomValue(activeThreadIdAtom)
  const filePath = stripFileProtocol(href)
  const fileName = filePath.split(/[/\\]/).pop() ?? ''
  const [isDir, setIsDir] = React.useState(false)
  React.useEffect(() => {
    window.api.invoke('file:is-directory', { filePath, conversationId })
      .then((res: any) => { if (res) setIsDir(true) })
      .catch(() => {})
  }, [filePath, conversationId])
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      if (isDir) {
        await window.api.invoke('file:open-path', { filePath, conversationId })
        return
      }
      const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as FileReadResult | undefined
      if (fileData) { setIsDiffMode(false); setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
    } catch (err) { console.error(err) }
  }
  const displayName = typeof children === 'string' && (children.includes('/') || children.includes('\\') || children.match(/^[a-zA-Z]:/)) ? children.split(/[/\\]/).pop() ?? children : children
  return (
    <span className="file-link" onClick={handleClick} title={isDir ? `Reveal folder ${filePath}` : `Open file ${filePath}`}>
      <span className="file-icon-wrapper-native">
        {isDir ? <Folder size={14} className="folder-icon-color" /> : <SymbolsFileIcon fileName={fileName} autoAssign={true} width={14} height={14} />}
      </span>
      <span className="file-name-wrapper">{displayName}</span>
    </span>
  )
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    toast.success('Code copied to clipboard')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const highlighted = (() => {
    const lang = hljs.getLanguage(language) ? language : 'plaintext'
    return hljs.highlight(code, { language: lang }).value
  })()
  return (
    <div className={`monaco-like-codeblock language-${language}`}>
      <div className="codeblock-header">
        <div className="codeblock-dots">
          <span className="codeblock-dot red" />
          <span className="codeblock-dot yellow" />
          <span className="codeblock-dot green" />
        </div>
        <span className="codeblock-header-title">{language || 'code'}</span>
        <button className="code-block-copy-btn" title="Copy code" onClick={handleCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="codeblock-body">
        <code className={`codeblock-code hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let active = true
    mermaid.render(`mermaid-${crypto.randomUUID()}`, code).then(({ svg: html }) => {
      if (active) { setSvg(html); setError(null) }
    }).catch(err => {
      console.error('Mermaid render error:', err)
      if (active) setError(err.message || String(err))
    })
    return () => { active = false }
  }, [code])
  if (error) return <pre className="language-mermaid pre-wrapper"><code className="hljs language-mermaid">{code}</code></pre>
  if (!svg) return <div className="mermaid-loading shimmer-text">Rendering diagram...</div>
  return <div className="mermaid-svg-wrapper" dangerouslySetInnerHTML={{ __html: svg }} />
}

const LocalImage: React.FC<{ src: string; alt?: string; title?: string }> = ({ src, alt, title }) => {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading')
  const conversationId = useAtomValue(activeThreadIdAtom)
  React.useEffect(() => {
    const isLocal = !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')
    if (!isLocal) { setDataUrl(src); setStatus('loaded'); return }
    let active = true
    const filePath = src.startsWith('file://') ? stripFileProtocol(src) : src
    window.api.invoke('file:read', { filePath, conversationId }).then((fileData: any) => {
      if (active && fileData?.isBinary && fileData.base64) {
        setDataUrl(`data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`)
        setStatus('loaded')
      } else if (active) setStatus('error')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [src, conversationId])
  if (status === 'loading') return <span className="local-image-container loading"><span className="local-image-loading-frame"><span className="tool-call-spinner"></span><span className="shimmer-text">Loading image...</span></span></span>
  if (status === 'error') return <span className="local-image-container loading"><span className="local-image-error-frame"><span>Failed to load image</span></span></span>
  return <img src={dataUrl || src} alt={alt || 'Image'} title={title} className="local-image-preview" />
}

const renderWithBr = (node: React.ReactNode): React.ReactNode => {
  if (typeof node === 'string') {
    if (!node.includes('<br')) return node
    return node.split(/<br\s*\/?>/gi).reduce((acc: React.ReactNode[], part, idx) => idx === 0 ? [part] : [...acc, <br key={idx} />, part], [])
  }
  if (React.isValidElement(node) && node.props && (node.props as any).children) {
    return React.cloneElement(node, { ...node.props, children: React.Children.map((node.props as any).children, renderWithBr) } as any)
  }
  return node
}
const components = {
  pre: ({ children }: any) => <>{children}</>,
  a: ({ href, children, ...props }: any) => href?.startsWith('file://') ? <FileLink href={href}>{children}</FileLink> : <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>,
  img: ({ src, alt, title }: any) => src ? <LocalImage src={src} alt={alt} title={title} /> : null,
  p: ({ children }: any) => <p>{React.Children.map(children, renderWithBr)}</p>,
  li: ({ children }: any) => <li>{React.Children.map(children, renderWithBr)}</li>,
  td: ({ children }: any) => <td>{React.Children.map(children, renderWithBr)}</td>,
  th: ({ children }: any) => <th>{React.Children.map(children, renderWithBr)}</th>,
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '')
    const language = match ? match[1] : ''
    const value = String(children).replace(/\n$/, '')
    if (className || value.includes('\n')) {
      return language === 'mermaid' ? <MermaidBlock code={value} /> : <CodeBlock language={language || 'plaintext'} code={value} />
    }
    return <code className={className} {...props}>{children}</code>
  }
}
const MarkdownRenderer = ({ content, isArtifact = false, id, ref }: MarkdownRendererProps) => {
  const normalizedContent = React.useMemo(() => normalizeMarkdownLinks(content), [content])
  return (
    <div ref={ref} id={id} className={`markdown-content${isArtifact ? ' markdown-artifact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components} urlTransform={(url) => url}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
MarkdownRenderer.displayName = 'MarkdownRenderer'

export interface MarkdownViewProps { displayFile: { name: string; path: string; content?: string }; activeWorkspace: { path: string } | null }

export const MarkdownView: React.FC<MarkdownViewProps> = ({ displayFile, activeWorkspace }) => {
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)
  return (
    <div className="fv-container">
      <div className="fv-header">
        <div className="fv-file-info-container">
          {isAgentArtifact(displayFile.name) ? getArtifactIcon(displayFile.name) : <SymbolsFileIcon fileName={displayFile.name} autoAssign={true} width={16} height={16} className="fv-file-icon" />}
          <span className="fv-file-name">{getDisplayName(displayFile.name)}</span>
          <span className="fv-file-dir">{getRelativeDirPath(displayFile.path, activeWorkspace?.path)}</span>
        </div>
        <div className="fv-toolbar-group">
          {displayFile.name === 'implementation_plan.md' && (
            <div className="action-button-group">
              <button className="reject-btn" onClick={() => { setGlobalPrompt({ prompt: 'I reject the implementation plan. Please make modifications based on my requirements.' }); toast.info('Rejected implementation plan. Agent notified.') }}>Reject</button>
              <button className="proceed-btn" onClick={() => { setGlobalPrompt({ prompt: 'I approve the implementation plan. Please proceed with execution.' }); toast.success('Approved plan. Proceeding with execution.') }}>Proceed</button>
            </div>
          )}
          <div title="Copy file content" onClick={() => { navigator.clipboard.writeText(displayFile.content ?? ''); toast.success('File content copied!') }} className="editor-toolbar-action"><Copy size={13} /></div>
        </div>
      </div>
      <div className="assistant-content content-container"><MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} /></div>
    </div>
  )
}
