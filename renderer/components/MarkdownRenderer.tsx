import React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { Copy, Check } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { globalPromptTriggerAtom, isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import { isAgentArtifact, getArtifactIcon, getDisplayName, getRelativeDirPath } from '../lib/uiUtils'
import { toast } from 'sonner'
import mermaid from 'mermaid'
import { stripFileProtocol } from '../lib/pathUtils'
import type { FileReadResult } from '../../preload/index.d'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import hljs from 'highlight.js'

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', flowchart: { useMaxWidth: true, htmlLabels: true } })

interface MarkdownRendererProps { content: string; isArtifact?: boolean; id?: string; isStreaming?: boolean; ref?: React.Ref<HTMLDivElement> }

const FileLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => {
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
  const conversationId = useAtomValue(activeThreadIdAtom)
  const filePath = stripFileProtocol(href)
  const fileName = filePath.split(/[/\\]/).pop() ?? ''
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as FileReadResult | undefined
      if (fileData) { setActiveEditorFile(fileData); setArtifactPanelMode('editor'); setArtifactPanelOpen(true) }
    } catch (err) { console.error(err) }
  }
  return (
    <span className="file-link" onClick={handleClick} title={`Open ${filePath}`} style={{ cursor: 'pointer' }}>
      <span className="file-icon-wrapper-native" style={{ display: 'inline-flex', alignItems: 'center', marginRight: '4px', verticalAlign: 'middle' }}>
        <SymbolsFileIcon fileName={fileName} autoAssign={true} width={14} height={14} />
      </span>
      <span className="file-name-wrapper">{children}</span>
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
    <pre className={`language-${language} pre-wrapper`}>
      {language && <span className="code-block-lang">{language}</span>}
      <button className="code-block-copy-btn" title="Copy code" onClick={handleCopy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
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
    const isLocal = (src.startsWith('file://') || src.startsWith('/') || src.match(/^[a-zA-Z]:/)) && !src.startsWith('data:')
    if (!isLocal) { setDataUrl(src); setStatus('loaded'); return }
    let active = true
    window.api.invoke('file:read', { filePath: stripFileProtocol(src), conversationId }).then((fileData: any) => {
      if (active && fileData?.isBinary && fileData.base64) {
        setDataUrl(`data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`)
        setStatus('loaded')
      } else if (active) setStatus('error')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false }
  }, [src, conversationId])
  if (status === 'loading') return <div className="local-image-container loading"><div className="local-image-loading-frame"><div className="tool-call-spinner"></div><span className="shimmer-text">Loading image...</span></div></div>
  if (status === 'error') return <div className="local-image-container loading"><div className="local-image-error-frame"><span>Failed to load image</span></div></div>
  return <img src={dataUrl || src} alt={alt || 'Image'} title={title} />
}

const components = {
  a: ({ href, children, ...props }: any) => href?.startsWith('file://') ? <FileLink href={href}>{children}</FileLink> : <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>,
  img: ({ src, alt, title }: any) => src ? <LocalImage src={src} alt={alt} title={title} /> : null,
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

const MarkdownRenderer = ({ content, isArtifact = false, id, ref }: MarkdownRendererProps) => (
  <div ref={ref} id={id} className={`markdown-content${isArtifact ? ' markdown-artifact' : ''}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
      {content}
    </ReactMarkdown>
  </div>
)

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
