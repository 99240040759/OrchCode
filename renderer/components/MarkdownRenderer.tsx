import React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import mermaid from 'mermaid'
import { isArtifactPanelOpenAtom, activeEditorFileAtom, artifactPanelModeAtom, activeThreadIdAtom } from '../store/agentStore'
import { stripFileProtocol } from '../lib/pathUtils'
import { parseMarkdown } from '../lib/markdownParser'
import { sanitizeHtml } from '../lib/uiUtils'
import type { FileReadResult } from '../../preload/index.d'
import debounce from 'lodash.debounce'
import { createRoot } from 'react-dom/client'
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

    const html = React.useMemo(() => isStreaming ? '' : sanitizeHtml(parseMarkdown(content)), [content, isStreaming])
    const containerRef = React.useRef<HTMLDivElement | null>(null)

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

      const resolveMermaid = async () => {
        if (!isStreaming) {
          const nodes = el.querySelectorAll('.mermaid') as NodeListOf<HTMLElement>
          const unrendered = Array.from(nodes).filter(n => n.getAttribute('data-processed') !== 'true')
          if (unrendered.length > 0) {
            try {
              await mermaid.run({ nodes: unrendered })
            } catch (err) {
              console.error('Mermaid render error:', err)
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
        roots.forEach(r => { try { r.unmount() } catch {} })
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
        dangerouslySetInnerHTML={isStreaming ? undefined : { __html: html }}
      />
    )
  }
)
MarkdownRenderer.displayName = 'MarkdownRenderer'

export default React.memo(MarkdownRenderer, (prev, next) =>
  prev.content === next.content &&
  prev.isArtifact === next.isArtifact &&
  prev.id === next.id &&
  prev.isStreaming === next.isStreaming
)
