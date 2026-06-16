export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}
export const isMac = window.api.platform === 'darwin'
export const decodeBase64Utf8 = (base64Str: string): string => {
  try {
    const binStr = atob(base64Str), bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch { return 'Failed to decode content' }
}
function oklchToHex(oklchStr: string): string {
  const match = oklchStr.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\w\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i)
  if (!match) return oklchStr
  const L = parseFloat(match[1]) / 100, C = parseFloat(match[2]), HStr = match[3], H = HStr === 'none' ? 0 : parseFloat(HStr), alphaStr = match[4]
  let A = 1
  if (alphaStr) { A = parseFloat(alphaStr); if (alphaStr.includes('%')) A = A / 100 }
  const hRad = (H * Math.PI) / 180, a = C * Math.cos(hRad), b = C * Math.sin(hRad)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_
  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  let b_ch = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  r = clamp(r); g = clamp(g); b_ch = clamp(b_ch)
  const gamma = (v: number) => v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v
  const R = Math.round(gamma(r) * 255), G = Math.round(gamma(g) * 255), B = Math.round(gamma(b_ch) * 255), Alpha = Math.round(A * 255)
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return A < 1 ? `#${hex(R)}${hex(G)}${hex(B)}${hex(Alpha)}` : `#${hex(R)}${hex(G)}${hex(B)}`
}
export const getOrchThemeColors = () => {
  const rootStyle = getComputedStyle(document.documentElement)
  const get = (prop: string, fallback: string) => {
    const val = rootStyle.getPropertyValue(prop).trim()
    return val ? oklchToHex(val) : fallback
  }
  return {
    bgApp: get('--bg-app', '#1a1a1a'),
    textPrimary: get('--text-primary', '#f3f3f3'),
    textSecondary: get('--text-secondary', '#a1a1aa'),
    textMuted: get('--text-muted', '#71717a'),
    accentBlue: get('--accent-blue', '#3b82f6'),
    accentGreen: get('--accent-green', '#10b981'),
    accentOrange: get('--accent-orange', '#f59e0b'),
    accentPurple: get('--accent-purple', '#8b5cf6'),
    accentRed: get('--accent-red', '#ef4444')
  }
}
