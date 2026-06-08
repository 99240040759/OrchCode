export const isMac = window.api.platform === 'darwin'
export const decodeBase64Utf8 = (base64Str: string): string => {
  try {
    const binStr = atob(base64Str)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch { return 'Failed to decode content' }
}
export const getOrchThemeColors = () => {
  const rootStyle = getComputedStyle(document.documentElement)
  return {
    bgApp: rootStyle.getPropertyValue('--bg-app').trim() || '#121212',
    textPrimary: rootStyle.getPropertyValue('--text-primary').trim() || '#f3f3f3',
    textSecondary: (rootStyle.getPropertyValue('--text-secondary').trim() || '#a1a1aa').replace('#', ''),
    textMuted: rootStyle.getPropertyValue('--text-muted').trim() || '#71717a',
    accentBlue: rootStyle.getPropertyValue('--accent-blue').trim() || '#3b82f6',
    accentGreen: rootStyle.getPropertyValue('--accent-green').trim() || '#10b981',
    accentOrange: rootStyle.getPropertyValue('--accent-orange').trim() || '#f59e0b',
    accentPurple: rootStyle.getPropertyValue('--accent-purple').trim() || '#8b5cf6',
    accentRed: rootStyle.getPropertyValue('--accent-red').trim() || '#ef4444'
  }
}
