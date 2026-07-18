export const MAX_ATTACHMENTS = 20
export function normalizePath(p: string): string {
  return p ? p.replace(/\\/g, '/') : ''
}
export function normalizePathForComparison(p: string, platform: string): string {
  const n = normalizePath(p)
  return platform === 'linux' ? n : n.toLowerCase()
}
export function getRelativePath(p: string, workspacePath?: string): string {
  if (!p) return ''
  const np = normalizePath(p)
  const nws = workspacePath ? normalizePath(workspacePath) : ''
  if (nws) {
    const normalizedWorkspace = nws.replace(/\/+$/, '')
    if (np === normalizedWorkspace) return ''
    if (np.startsWith(`${normalizedWorkspace}/`)) return np.substring(normalizedWorkspace.length + 1)
  }
  return np
}
export function getAbsolutePath(p: string, workspacePath?: string): string {
  if (!p) return ''
  const np = normalizePath(p)
  if (/^[a-zA-Z]:\//.test(np) || /^\//.test(np)) return np
  const nws = workspacePath ? normalizePath(workspacePath) : ''
  if (!nws) return np
  const baseParts = nws.replace(/\/+$/, '').split('/')
  const resolved = [...baseParts]
  const minimumLength = baseParts.length
  for (const part of np.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (resolved.length > minimumLength) resolved.pop()
      continue
    }
    resolved.push(part)
  }
  return resolved.join('/')
}
export const MENTION_REGEX = /@\[([^\]]+)\]|@([^\s]+)/g
export const TRAILING_PUNCT = /[),.:;!?`'"]+$/
export const LEADING_PUNCT = /^[(`'"]+/
