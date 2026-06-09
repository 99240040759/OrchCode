import { parseMarkdownIncremental, clearMarkdownCache } from '../lib/markdownParser'

self.onmessage = (e: MessageEvent) => {
  const { type, content, targetId, version } = e.data
  if (type === 'clear-cache') {
    clearMarkdownCache(targetId)
    return
  }
  if (type !== 'compile') return
  try {
    const html = parseMarkdownIncremental(content, targetId)
    self.postMessage({ html, targetId, version })
  } catch (err) {
    self.postMessage({ html: `<div class="error-markdown">Failed to render markdown: ${err instanceof Error ? err.message : String(err)}</div>`, targetId, version })
  }
}
