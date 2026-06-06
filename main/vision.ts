/**
 * Helper to determine model capabilities based on model ID.
 * Based on Supabase Edge Function configurations and official model documentation.
 */

/**
 * Checks if a model natively supports vision (image/video processing).
 */
export function checkModelVisionSupport(modelId: string): boolean {
  const id = modelId.toLowerCase()

  // Verified vision models based on docs and Edge Function config:
  // - Gemini models (gemini-3.1-flash-lite, etc.)
  // - Gemma 4 series (gemma-4-31b-it) supports multimodal
  // - Kimi K2.6 (nvidia/moonshotai/kimi-k2.6) supports native vision
  // - MiMo V2.5 (opencode/mimo-v2.5-free) supports native vision
  // - GLM 4.6V Flash (zai/glm-4.6v-flash) supports native vision
  if (
    id.includes('gemini') ||
    id.includes('gemma') ||
    id.includes('kimi') ||
    id.includes('mimo') ||
    id.includes('glm-4.6v')
  ) {
    return true
  }

  // Verified text-only models (no native vision):
  // - DeepSeek (opencode/deepseek-v4-flash-free)
  // - Big Pickle (opencode/big-pickle)
  // - GLM 4.5 Flash (zai/glm-4.5-flash)
  // - Default fallback to false to prevent API crashes on unknown models
  return false
}

/**
 * Checks if the model natively supports arbitrary file attachments
 * via Vercel AI SDK (e.g. PDFs, documents passed natively).
 *
 * Currently, only Google Gemini models have robust native arbitrary file
 * processing in our setup. Others require files to be text-extracted.
 */
export function checkModelNativeFileSupport(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (id.includes('gemini') || id.startsWith('google/')) {
    return true
  }
  return false
}
