import { parseMarkdown } from '../lib/markdownParser'

self.onmessage = (e: MessageEvent) => {
  const { type, content, targetId, version } = e.data
  if (type !== 'compile') return
  const html = parseMarkdown(content)
  self.postMessage({ html, targetId, version })
}
