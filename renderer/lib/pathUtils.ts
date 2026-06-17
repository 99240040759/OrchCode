export const getBasename = (p: string): string => p.split(/[/\\]/).pop() ?? p
export const getWorkspaceName = (p: string): string => getBasename(p) || 'Workspace'
export const normalizeSeparators = (p: string): string => p.toLowerCase().replace(/\\/g, '/')
export function getRelativeDirPath(filePath: string, workspacePath?: string): string {
  let path = filePath
  if (workspacePath && path.startsWith(workspacePath)) path = path.slice(workspacePath.length)
  else path = path.replace(/^.*[/\\](conversations|sessions)[/\\][^/\\]+[/\\]/, '')
  if (path.startsWith('/') || path.startsWith('\\')) path = path.slice(1)
  const parts = path.split(/[/\\]/)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}
function normalizePathOrUrl(url: string): string {
  const clean = url.replace(/\\/g, '/')
  if (clean.startsWith('#') || (clean.includes(':') && !clean.match(/^[a-zA-Z]:/) && !clean.startsWith('file://'))) return url
  let fmt = (!clean.startsWith('file://') && !clean.startsWith('/') && !clean.match(/^[a-zA-Z]:/))
    ? 'file:///' + (clean.startsWith('./') ? clean.slice(2) : clean)
    : clean.replace(/^file:\/{0,3}/, 'file:///').replace(/^file:\/\/\/([a-zA-Z]:)/, 'file:///$1')
  if (!fmt.startsWith('file:///')) fmt = fmt.startsWith('/') ? 'file://' + fmt : 'file:///' + fmt
  try { fmt = encodeURI(decodeURI(fmt)) } catch { fmt = encodeURI(fmt) }
  return fmt
}
export function stripFileProtocol(href: string): string {
  const stripped = href.replace(/^file:\/{0,3}/, '')
  let filePath = decodeURIComponent(stripped)
  if (!filePath.match(/^[a-zA-Z]:/) && !filePath.startsWith('/')) filePath = '/' + filePath
  return filePath
}
function convertPlainPathsToMarkdownLinks(content: string): string {
  if (!content) return ''
  let processed = content.replace(/`([a-zA-Z]:[\\\/][^`\n]*)`/g, (_, path) => `[${path}](file:///${path.replace(/\\/g, '/')})`)
  const links: string[] = []
  let placeholderIndex = 0
  processed = processed.replace(/(!?\[[^\[\]]*\]\([^)]*\)|```[\s\S]*?```|`[^`\n]+`|file:\/\/\/[a-zA-Z]:[\\\/][^\s\)\(]*)/g, (match) => {
    links.push(match)
    return `__MD_LINK_PLACEHOLDER_${placeholderIndex++}__`
  })
  const windowsPathRegex = /\b([a-zA-Z]:[\\\/][^\s\)\(]*[^\s\)\(\.,!\?;:])(?=\s|$|\b)/g
  processed = processed.replace(windowsPathRegex, (match) => `[${match}](file:///${match.replace(/\\/g, '/')})`)
  return processed.replace(/__MD_LINK_PLACEHOLDER_(\d+)__/g, (_, idx) => links[parseInt(idx, 10)])
}
export function normalizeMarkdownLinks(content: string): string {
  if (!content) return ''
  const withLinks = convertPlainPathsToMarkdownLinks(content)
  return withLinks.replace(/(!?\[[^\[\]]*\])\(([^)]*)\)/g, (_, label, url) => `${label}(${normalizePathOrUrl(url)})`)
}
