import { getEncoding, encodingForModel, Tiktoken } from 'js-tiktoken'
const cache = new Map<string, Tiktoken>()
export function cleanModelId(modelId?: string): string {
  if (!modelId) return 'gpt-4o'
  return modelId.replace(/^(zai|opencode|nvidia)\//, '')
}
export function getCachedEncoder(modelId?: string): Tiktoken {
  const model = cleanModelId(modelId)
  let enc = cache.get(model)
  if (!enc) {
    try { enc = encodingForModel(model as any) } catch {
      try { enc = getEncoding(model.includes('4o') || model.includes('o1') || model.includes('o3') ? 'o200k_base' : 'cl100k_base') }
      catch { enc = getEncoding('o200k_base') }
    }
    cache.set(model, enc)
  }
  return enc
}
export function countTokens(text: string, modelId?: string): number {
  if (!text) return 0
  return getCachedEncoder(modelId).encode(text).length
}
export function countMessagesTokens(messages: any[], modelId?: string): number {
  const enc = getCachedEncoder(modelId)
  let total = 0
  for (const msg of messages) {
    total += 3
    if (msg.name) total += 1
    if (typeof msg.content === 'string') { total += enc.encode(msg.content).length }
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) { total += enc.encode(part.text).length }
        else if (part.type === 'image_url') { total += 260 }
      }
    }
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.name) total += enc.encode(tc.function.name).length
        if (tc.function?.arguments) total += enc.encode(tc.function.arguments).length
      }
    }
  }
  total += 3
  return total
}
