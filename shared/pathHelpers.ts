export const MAX_ATTACHMENTS = 20

export function normalizePath(p: string): string {
  if (!p) return ''
  return p.replace(/\\/g, '/')
}

export function getRelativePath(p: string, workspacePath?: string): string {
  if (!p) return ''
  const np = normalizePath(p)
  const nws = workspacePath ? normalizePath(workspacePath) : ''
  if (nws && np.toLowerCase().startsWith(nws.toLowerCase())) {
    return np.substring(nws.length).replace(/^\//, '')
  }
  return np
}

export function getAbsolutePath(p: string, workspacePath?: string): string {
  if (!p) return ''
  const np = normalizePath(p)
  const isAbsolute = /^[a-zA-Z]:/.test(np) || /^\//.test(np)
  if (isAbsolute) return np
  const nws = workspacePath ? normalizePath(workspacePath) : ''
  if (nws) {
    return `${nws}/${np}`.replace(/\/\//g, '/')
  }
  return np
}
export const MENTION_REGEX = /@\[([^\]]+)\]|@([^\s]+)/g
export const TRAILING_PUNCT = /[),.:;!?`'"]+$/
export const LEADING_PUNCT = /^[(`'"]+/
