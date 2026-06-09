import { Marked } from 'marked'
import hljs from 'highlight.js'
import katex from 'katex'
import { normalizeMarkdownLinks, stripFileProtocol } from './pathUtils'
import { sanitizeHtml } from './uiUtils'

function getFileIconSvg(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  let color = '#94a3b8'
  if (['js', 'jsx'].includes(ext)) color = '#f7df1e'
  else if (['ts', 'tsx'].includes(ext)) color = '#3178c6'
  else if (['py'].includes(ext)) color = '#3776ab'
  else if (['go'].includes(ext)) color = '#00add8'
  else if (['rs'].includes(ext)) color = '#dea584'
  else if (['html'].includes(ext)) color = '#e34f26'
  else if (['css'].includes(ext)) color = '#1572b6'
  else if (['json'].includes(ext)) color = '#cbd5e1'
  else if (['md'].includes(ext)) color = '#0891b2'
  else if (['sh', 'bash'].includes(ext)) color = '#4caf50'
  else if (['sql'].includes(ext)) color = '#00758f'
  else if (['c', 'cpp', 'h'].includes(ext)) color = '#659ad2'
  return `<svg class="file-icon-wrapper" style="color: ${color}; min-width: 14px;" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`
}

const renderer = {
  hr(): string { return '' },
  code(token: { text: string; lang?: string }): string {
    const code = token.text, lang = token.lang || ''
    if (lang === 'mermaid') return `<div class="mermaid">${code}</div>`
    const language = hljs.getLanguage(lang) ? lang : 'plaintext'
    const highlighted = hljs.highlight(code, { language }).value
    const copyBtn = `<button class="code-block-copy-btn" title="Copy code"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>`
    if (lang) return `<pre class="language-${language} pre-wrapper"><span class="code-block-lang">${language}</span>${copyBtn}<code class="hljs language-${language}">${highlighted}</code></pre>`
    return `<pre><code class="hljs">${highlighted}</code></pre>`
  },
  link(token: { href: string; title?: string | null; text: string }): string {
    const { href, title, text } = token
    if (href?.startsWith('file://')) {
      const filePath = stripFileProtocol(href)
      const fileName = filePath.split(/[/\\]/).pop() ?? ''
      return `<span class="file-link" data-href="${href}" title="Open ${filePath}">${getFileIconSvg(fileName)}<span class="file-name-wrapper">${text}</span></span>`
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`
  },
  image(token: { href: string; title?: string | null; text: string }): string {
    const { href, title, text } = token
    return `<img src="${href}" alt="${text || 'Image'}"${title ? ` title="${title}"` : ''} />`
  }
}

const marked = new Marked()
marked.use({ renderer })

interface MathExtracted {
  processed: string
  mathBlocks: string[]
  mathSessionId: string
}

const mathCache = new Map<string, string>()

function extractMathBlocks(content: string): MathExtracted {
  const mathBlocks: string[] = []
  const mathSessionId = Math.random().toString(36).substring(2, 10)

  let processed = content.replace(
    /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\\\[[\s\S]*?\\\\\])/g,
    (match) => {
      let rawMath = match
      if (match.startsWith('$$')) rawMath = match.slice(2, -2)
      else { const s = match.indexOf('['), e = match.lastIndexOf(']'); if (s !== -1 && e !== -1) rawMath = match.slice(s + 1, e) }
      
      const key = 'd_' + rawMath.trim()
      try {
        let compiled = mathCache.get(key)
        if (!compiled) {
          compiled = katex.renderToString(rawMath.trim(), { displayMode: true, throwOnError: false })
          if (mathCache.size > 1000) mathCache.clear()
          mathCache.set(key, compiled)
        }
        const placeholder = `__MATH_BLOCK_${mathSessionId}_${mathBlocks.length}__`
        mathBlocks.push(compiled)
        return placeholder
      } catch { return match }
    }
  )

  processed = processed.replace(
    /(\\\([\s\S]*?\\\)|(?<!\\)\$[^\$\n]+?\$)/g,
    (match) => {
      let rawMath = match
      if (match.startsWith('$')) rawMath = match.slice(1, -1)
      else { const s = match.indexOf('('), e = match.lastIndexOf(')'); if (s !== -1 && e !== -1) rawMath = match.slice(s + 1, e) }
      
      const key = 'i_' + rawMath.trim()
      try {
        let compiled = mathCache.get(key)
        if (!compiled) {
          compiled = katex.renderToString(rawMath.trim(), { displayMode: false, throwOnError: false })
          if (mathCache.size > 1000) mathCache.clear()
          mathCache.set(key, compiled)
        }
        const placeholder = `__MATH_BLOCK_${mathSessionId}_${mathBlocks.length}__`
        mathBlocks.push(compiled)
        return placeholder
      } catch { return match }
    }
  )

  return { processed, mathBlocks, mathSessionId }
}

function restoreMathBlocks(html: string, mathBlocks: string[], mathSessionId: string): string {
  for (let i = 0; i < mathBlocks.length; i++) {
    html = html.replace(new RegExp(`__MATH_BLOCK_${mathSessionId}_${i}__`, 'g'), () => mathBlocks[i])
  }
  return html
}

export function parseMarkdown(content: string): string {
  if (!content) return ''
  const { processed, mathBlocks, mathSessionId } = extractMathBlocks(content)
  const html = marked.parse(normalizeMarkdownLinks(processed)) as string
  return restoreMathBlocks(sanitizeHtml(html), mathBlocks, mathSessionId)
}

interface CachedBlock { text: string; html: string }
const compileCache = new Map<string, CachedBlock[]>()
const MAX_CACHE_ENTRIES = 50

function evictOldestIfNeeded() {
  if (compileCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = compileCache.keys().next().value
    if (firstKey) compileCache.delete(firstKey)
  }
}

export function clearMarkdownCache(targetId: string) { for (const k of compileCache.keys()) { if (k.includes(targetId)) compileCache.delete(k) } }

export function parseMarkdownIncremental(content: string, targetId: string): string {
  if (!content) return ''
  const { processed, mathBlocks, mathSessionId } = extractMathBlocks(content)
  const tokens = marked.lexer(normalizeMarkdownLinks(processed))
  let cache = compileCache.get(targetId)
  if (!cache) { cache = []; compileCache.set(targetId, cache); evictOldestIfNeeded() }
  const htmlSegments: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (i < tokens.length - 1) {
      if (cache[i] && cache[i].text === token.raw) htmlSegments.push(cache[i].html)
      else { const compiled = sanitizeHtml(marked.parser([token])); cache[i] = { text: token.raw, html: compiled }; htmlSegments.push(compiled) }
    } else htmlSegments.push(sanitizeHtml(marked.parser([token])))
  }
  return restoreMathBlocks(htmlSegments.join('\n'), mathBlocks, mathSessionId)
}

