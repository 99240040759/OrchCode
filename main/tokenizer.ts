// Universal token estimator — model-agnostic, consistent, no BPE dependency.
// Uses UTF-8 byte length / 4 which approximates most LLM tokenizers (BPE, SentencePiece,
// BytePiece) within ~10%. Consistent across all models, no false precision.
// This avoids tiktoken's OpenAI-specific BPE giving wildly wrong counts for Gemini/Claude.

export function cleanModelId(modelId?: string): string {
  if (!modelId) return 'unknown'
  return modelId.replace(/^(zai|opencode|nvidia)\//, '')
}

function estimateTokens(text: string): number {
  if (!text) return 0
  // UTF-8 byte length / 4 ≈ tokens for mixed English/code content
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4)
}

export function countTokens(text: string, _modelId?: string): number {
  return estimateTokens(text)
}

export function countMessagesTokens(messages: any[], _modelId?: string): number {
  let total = 0
  for (const msg of messages) {
    total += 4 // per-message overhead (role + framing)
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text' && part.text) total += estimateTokens(part.text)
        else if (part.type === 'image_url') total += 340 // flat image token cost estimate
      }
    }
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.name) total += estimateTokens(tc.function.name)
        if (tc.function?.arguments) total += estimateTokens(tc.function.arguments)
      }
    }
    if (msg.name) total += estimateTokens(msg.name)
  }
  total += 3 // reply priming
  return total
}
