import { getEncoding } from 'js-tiktoken'

let _enc: any = null

setTimeout(() => {
  try {
    _enc = getEncoding('cl100k_base')
  } catch (err) {
    console.error('[tokenizer] Tiktoken load failed, using char approximation', err)
  }
}, 100)

export function estimateTokens(text: string): number {
  if (!text) return 0
  if (!_enc) return Math.ceil(text.length / 4)
  try {
    return _enc.encode(text).length
  } catch {
    return Math.ceil(text.length / 4)
  }
}
