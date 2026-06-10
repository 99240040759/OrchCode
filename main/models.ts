import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { streamText } from 'ai'
import { globalApiLimiter } from './utils'
import { requireAuthToken } from './auth'

export interface ModelCapabilities { vision: boolean; nativeFiles: boolean }
export interface ModelInfo { id: string; name: string; capabilities: ModelCapabilities }
export type AvailableModels = Record<string, ModelInfo>

let cachedModels: AvailableModels | null = null
let cachedModelsAt = 0
const MODELS_TTL_MS = 5 * 60 * 1000

function createAuthFetch(useAnon = false, extra?: Record<string, string>) {
  return (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers || {})
    headers.set('Authorization', `Bearer ${useAnon ? (process.env.SUPABASE_ANON_KEY || '') : requireAuthToken()}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
    if (extra) { for (const [k, v] of Object.entries(extra)) headers.set(k, v) }
    
    const fetchOptions: RequestInit = {
      signal: AbortSignal.timeout(30000),
      ...options,
      headers
    }
    return fetch(url, fetchOptions)
  }
}

export async function getAvailableModels(force = false): Promise<AvailableModels> {
  if (!force && cachedModels && Date.now() - cachedModelsAt < MODELS_TTL_MS) return cachedModels
  const response = await createAuthFetch(true)(`${process.env.SUPABASE_URL}/functions/v1/api/models`)
  if (!response.ok) throw new Error(`Failed to fetch models: HTTP ${response.status}`)
  cachedModels = await response.json(); cachedModelsAt = Date.now()
  return cachedModels!
}

const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/api/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const nvidia = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/api/nvidia/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const opencode = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/api/opencode/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const zai = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/api/z-ai/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

export const googleBypass = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/api/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => {
    const headers = new Headers(options?.headers || {})
    headers.set('Authorization', `Bearer ${requireAuthToken()}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY || '')
    return fetch(url, { ...options, headers, signal: AbortSignal.timeout(30000) })
  }
})

const GEMMA4_THINKING_MODEL_IDS = new Set([
  'gemma-4-26b-a4b-it',
])

export function resolveModel(modelId: string): {
  model: Parameters<typeof streamText>[0]['model']
  providerOptions: ProviderOptions
} {
  if (modelId.startsWith('zai/')) return { model: zai.chat(modelId.replace('zai/', '')), providerOptions: {} }
  if (modelId.startsWith('opencode/')) return { model: opencode.chat(modelId.replace('opencode/', '')), providerOptions: {} }
  if (modelId.startsWith('nvidia/')) return { model: nvidia.chat(modelId.replace('nvidia/', '')), providerOptions: {} }
  if (GEMMA4_THINKING_MODEL_IDS.has(modelId)) return { model: google(modelId), providerOptions: { google: { chatTemplateKwargs: { enable_thinking: true } } } as ProviderOptions }
  return { model: google(modelId), providerOptions: { google: { thinkingConfig: { thinkingLevel: 'auto', includeThoughts: true } } } as ProviderOptions }
}
