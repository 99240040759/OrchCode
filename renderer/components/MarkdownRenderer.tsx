import React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { Copy } from 'lucide-react'
import { globalPromptTriggerAtom } from '../store/agentStore'
import { isAgentArtifact, getArtifactIcon, getDisplayName, getRelativeDirPath } from '../lib/uiUtils'
import { toast } from 'sonner'
import mermaid from 'mermaid'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import { stripFileProtocol } from '../lib/pathUtils'
import { parseMarkdown, parseMarkdownIncremental } from '../lib/markdownParser'
import type { FileReadResult } from '../../preload/index.d'
import debounce from 'lodash.debounce'
import { createRoot } from 'react-dom/client'
import morphdom from 'morphdom'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
  flowchart: { useMaxWidth: true, htmlLabels: true }
})

interface MarkdownRendererProps {
  content: string
  isArtifact?: boolean
  id?: string
  isStreaming?: boolean
}

const MarkdownRenderer = React.forwardRef<HTMLDivElement, MarkdownRendererProps>(
  ({ content, isArtifact = false, id, isStreaming = false }, ref) => {
    const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
    const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
    const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)
    const conversationId = useAtomValue(activeThreadIdAtom)

    const html = React.useMemo(() => {
      if (isStreaming && id) return parseMarkdownIncremental(content, id)
      return parseMarkdown(content)
    }, [content, isStreaming, id])
    const containerRef = React.useRef<HTMLDivElement | null>(null)

    React.useLayoutEffect(() => {
      if (!containerRef.current) return
      if (isStreaming && containerRef.current.hasChildNodes()) {
        try {
          morphdom(containerRef.current, `<div>${html}</div>`, { childrenOnly: true })
        } catch (err) {
          console.error('[MarkdownRenderer] morphdom error:', err)
          containerRef.current.innerHTML = html
        }
      } else {
        containerRef.current.innerHTML = html
      }
    }, [html, isStreaming])

    React.useEffect(() => {
      const el = containerRef.current
      if (!el) return
      let active = true
      const roots: any[] = []

      const handleGlobalClick = async (e: MouseEvent) => {
        const fileLink = (e.target as HTMLElement).closest('.file-link')
        if (fileLink) {
          e.preventDefault()
          const href = fileLink.getAttribute('data-href')
          if (href) {
            const filePath = stripFileProtocol(href)
            try {
              const fileData = await window.api.invoke('file:read', { filePath, conversationId }) as FileReadResult | undefined
              if (fileData) {
                setActiveEditorFile(fileData)
                setArtifactPanelMode('editor')
                setArtifactPanelOpen(true)
              }
            } catch (err) {
              console.error(err)
            }
          }
          return
        }
        const copyBtn = (e.target as HTMLElement).closest('.code-block-copy-btn')
        if (copyBtn) {
          e.preventDefault()
          const codeEl = copyBtn.parentNode?.querySelector('code')
          if (codeEl) {
            navigator.clipboard.writeText(codeEl.innerText)
            toast.success('Code copied to clipboard')
            const orig = copyBtn.innerHTML
            copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
            setTimeout(() => { copyBtn.innerHTML = orig }, 2000)
          }
        }
      }

      const resolveImages = async () => {
        const imgs = el.querySelectorAll('img')
        for (const img of Array.from(imgs)) {
          const src = img.getAttribute('src')
          if (src && (src.startsWith('file://') || src.startsWith('/') || src.match(/^[a-zA-Z]:/)) && !src.startsWith('data:')) {
            let parent = img.parentElement
            if (!parent || !parent.classList.contains('local-image-container')) {
              const wrapper = document.createElement('div')
              wrapper.className = 'local-image-container loading'
              const loader = document.createElement('div')
              loader.className = 'local-image-loading-frame'
              loader.innerHTML = '<div class="tool-call-spinner"></div><span class="shimmer-text">Loading image...</span>'
              img.parentNode?.insertBefore(wrapper, img)
              wrapper.appendChild(loader)
              wrapper.appendChild(img)
              img.style.display = 'none'
              parent = wrapper
            }
            try {
              const fileData = await window.api.invoke('file:read', { filePath: stripFileProtocol(src), conversationId }) as FileReadResult | undefined
              if (active && fileData?.isBinary && fileData.base64) {
                img.setAttribute('src', `data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`)
                img.style.display = ''
                parent.querySelector('.local-image-loading-frame')?.remove()
                parent.classList.remove('loading')
              } else if (active) {
                const f = parent.querySelector('.local-image-loading-frame')
                if (f) { f.className = 'local-image-error-frame'; f.innerHTML = '<span>Failed to load image</span>' }
              }
            } catch {
              if (active) {
                const f = parent.querySelector('.local-image-loading-frame')
                if (f) { f.className = 'local-image-error-frame'; f.innerHTML = '<span>Failed to load image</span>' }
              }
            }
          }
        }
      }

      const resolveFileIcons = () => {
        const fileLinks = el.querySelectorAll('.file-link')
        fileLinks.forEach((linkEl) => {
          if (linkEl.getAttribute('data-mounted') === 'true') return
          linkEl.setAttribute('data-mounted', 'true')
          const text = linkEl.querySelector('.file-name-wrapper')?.textContent || linkEl.textContent || ''
          const fileName = text.split(/[/\\]/).pop() ?? ''
          linkEl.innerHTML = '<span class="react-icon-root"></span><span class="file-name-wrapper"></span>'
          const iconRoot = linkEl.querySelector('.react-icon-root')
          const nameWrapper = linkEl.querySelector('.file-name-wrapper')
          if (nameWrapper) nameWrapper.textContent = text
          if (iconRoot) {
            const root = createRoot(iconRoot)
            root.render(<SymbolsFileIcon fileName={fileName} autoAssign={true} width={14} height={14} />)
            roots.push(root)
          }
        })
      }

      const hasMermaid = content.includes('```mermaid') || content.includes('class="mermaid"')
      const resolveMermaid = async () => {
        if (!isStreaming && hasMermaid) {
          const nodes = el.querySelectorAll('.mermaid') as NodeListOf<HTMLElement>
          const unrendered = Array.from(nodes).filter(n => n.getAttribute('data-processed') !== 'true')
          if (unrendered.length > 0) {
            try {
              await mermaid.run({ nodes: unrendered })
            } catch (err) {
              console.error('Mermaid render error:', err)
              unrendered.forEach(node => {
                const text = node.textContent || ''
                node.innerHTML = `<pre><code class="hljs language-mermaid">${text}</code></pre>`
                node.classList.remove('mermaid')
                node.classList.add('language-mermaid', 'pre-wrapper')
              })
            }
          }
        }
      }

      el.addEventListener('click', handleGlobalClick)
      resolveImages()
      resolveFileIcons()
      resolveMermaid()

      const debouncedResolve = debounce(() => {
        if (active) {
          resolveImages()
          resolveFileIcons()
        }
      }, 500)
      const obs = new MutationObserver(() => { debouncedResolve() })
      obs.observe(el, { childList: true, subtree: true })

      return () => {
        active = false
        el.removeEventListener('click', handleGlobalClick)
        obs.disconnect()
        roots.forEach(r => { try { r.unmount() } catch (err) { console.debug('[MarkdownRenderer] Unmount error:', err) } })
      }
    }, [html, conversationId, isStreaming, setActiveEditorFile, setArtifactPanelMode, setArtifactPanelOpen])

    return (
      <div
        ref={(node) => {
          containerRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        id={id}
        className={`markdown-content${isArtifact ? ' markdown-artifact' : ''}`}
      />
    )
  }
)

export default React.memo(MarkdownRenderer, (prev, next) =>
  prev.content === next.content &&
  prev.isArtifact === next.isArtifact &&
  prev.id === next.id &&
  prev.isStreaming === next.isStreaming
)
MarkdownRenderer.displayName = 'MarkdownRenderer'

export interface MarkdownViewProps {
  displayFile: { name: string; path: string; content?: string }
  activeWorkspace: { path: string } | null
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ displayFile, activeWorkspace }) => {
  const setGlobalPrompt = useSetAtom(globalPromptTriggerAtom)
  return (
    <div className="fv-container">
      <div className="fv-header">
        <div className="fv-file-info-container">
          {isAgentArtifact(displayFile.name) ? getArtifactIcon(displayFile.name) : (
            <SymbolsFileIcon fileName={displayFile.name} autoAssign={true} width={16} height={16} className="fv-file-icon" />
          )}
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
          <div title="Copy file content" onClick={() => { navigator.clipboard.writeText(displayFile.content ?? ''); toast.success('File content copied!') }} className="editor-toolbar-action">
            <Copy size={13} />
          </div>
        </div>
      </div>
      <div className="assistant-content content-container">
        <MarkdownRenderer isArtifact={true} content={displayFile.content ?? ''} />
      </div>
    </div>
  )
}
