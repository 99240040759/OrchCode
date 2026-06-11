export function normalizePathOrUrl(url: string): string {
  const clean = url.replace(/\\/g, '/')
  if (!clean.startsWith('file://') && !clean.startsWith('/') && !clean.match(/^[a-zA-Z]:/)) return url
  let fmt = clean.replace(/^file:\/\/\/?/, 'file:///').replace(/^file:\/\/\/([a-zA-Z]:)/, 'file:///$1')
  if (!fmt.startsWith('file:///')) fmt = fmt.startsWith('/') ? 'file://' + fmt : 'file:///' + fmt
  try { fmt = encodeURI(decodeURI(fmt)) } catch { fmt = encodeURI(fmt) }
  return fmt
}

export function stripFileProtocol(href: string): string {
  const stripped = href.replace(/^file:\/\/\/?/, '')
  let filePath = decodeURIComponent(stripped)
  if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) filePath = '/' + filePath
  return filePath
}

export function convertPlainPathsToMarkdownLinks(content: string): string {
  if (!content) return ''
  let processed = content.replace(/`([a-zA-Z]:[\\/][^`\n]*)`/g, (_, path) => `[${path}](file:///${path.replace(/\\/g, '/')})`)
  const links: string[] = []
  let placeholderIndex = 0
  processed = processed.replace(/(!?\[[^\[\]]*\]\([^)]*\)|```[\s\S]*?```|`[^`\n]+`|file:\/\/\/[a-zA-Z]:[\\/][^\s\)\(]*)/g, (match) => {
    links.push(match)
    return `__MD_LINK_PLACEHOLDER_${placeholderIndex++}__`
  })
  const windowsPathRegex = /\b([a-zA-Z]:[\\/][^\s\)\(]*[^\s\)\(\.,!\?;:])(?=\s|$|\b)/g
  processed = processed.replace(windowsPathRegex, (match) => `[${match}](file:///${match.replace(/\\/g, '/')})`)
  return processed.replace(/__MD_LINK_PLACEHOLDER_(\d+)__/g, (_, idx) => links[parseInt(idx, 10)])
}

export function normalizeMarkdownLinks(content: string): string {
  if (!content) return ''
  const withLinks = convertPlainPathsToMarkdownLinks(content)
  return withLinks.replace(/(!?\[[^\[\]]*\])\(([^)]*)\)/g, (_, label, url) => {
    return `${label}(${normalizePathOrUrl(url)})`
  })
}
