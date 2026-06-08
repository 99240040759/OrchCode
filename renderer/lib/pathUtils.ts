export function normalizePathOrUrl(url: string): string {
  const clean = url.replace(/\\/g, '/')
  if (!clean.startsWith('file://') && !clean.startsWith('/') && !clean.match(/^[a-zA-Z]:/)) return url
  let fmt = clean.replace(/^file:\/\/\/?/, 'file:///').replace(/^file:\/\/\/([a-zA-Z]:)/, 'file:///$1')
  if (!fmt.startsWith('file:///')) fmt = fmt.startsWith('/') ? 'file://' + fmt : 'file:///' + fmt
  try { fmt = encodeURI(decodeURI(fmt)) } catch { fmt = fmt.replace(/ /g, '%20') }
  return fmt
}

export function stripFileProtocol(href: string): string {
  const stripped = href.replace(/^file:\/\/\/?/, '')
  let filePath = decodeURIComponent(stripped)
  if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) filePath = '/' + filePath
  return filePath
}

export function normalizeMarkdownLinks(content: string): string {
  if (!content) return ''
  // Match markdown links/images: label is [text] or ![text], url is (url)
  // Use [^\[\]] to avoid crossing bracket boundaries (fixes nested [![img](u)](link))
  return content.replace(/(!?\[[^\[\]]*\])\(([^)]*)\)/g, (_, label, url) => {
    return `${label}(${normalizePathOrUrl(url)})`
  })
}
