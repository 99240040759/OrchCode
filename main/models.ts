import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { streamText } from 'ai'
import { globalApiLimiter } from './limiters'
import { requireAuthToken } from './auth'

export interface ModelInfo { id: string; name: string }
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
    
    const fetchOptions: RequestInit & { dispatcher?: any } = { ...options, headers }
    try {
      const undici = require('undici')
      if (!(globalThis as any)._customUndiciAgent) {
        (globalThis as any)._customUndiciAgent = new undici.Agent({ headersTimeout: 15 * 60 * 1000, bodyTimeout: 15 * 60 * 1000 })
      }
      fetchOptions.dispatcher = (globalThis as any)._customUndiciAgent
    } catch (e) {
      // Ignore if undici isn't available
    }

    return fetch(url, fetchOptions)
  }
}

export async function getAvailableModels(force = false): Promise<AvailableModels> {
  if (!force && cachedModels && Date.now() - cachedModelsAt < MODELS_TTL_MS) return cachedModels
  const response = await createAuthFetch(true)(`${process.env.SUPABASE_URL}/functions/v1/models`)
  if (!response.ok) throw new Error(`Failed to fetch models: HTTP ${response.status}`)
  cachedModels = await response.json(); cachedModelsAt = Date.now()
  return cachedModels!
}

const google = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const nvidia = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/nvidia/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const opencode = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/opencode/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

const zai = createOpenAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/z-ai/v1`,
  apiKey: 'placeholder',
  fetch: (url, options) => globalApiLimiter.schedule(() => createAuthFetch()(url, options))
})

export const googleBypass = createGoogleGenerativeAI({
  baseURL: `${process.env.SUPABASE_URL}/functions/v1/gemini/v1beta`,
  apiKey: 'placeholder',
  fetch: createAuthFetch()
})

export function resolveModel(modelId: string): {
  model: Parameters<typeof streamText>[0]['model']
  providerOptions: ProviderOptions
} {
  if (modelId.startsWith('zai/')) return { model: zai.chat(modelId.replace('zai/', '')), providerOptions: {} }
  if (modelId.startsWith('opencode/')) return { model: opencode.chat(modelId.replace('opencode/', '')), providerOptions: {} }
  if (modelId.startsWith('nvidia/')) return { model: nvidia.chat(modelId.replace('nvidia/', '')), providerOptions: {} }
  if (modelId.includes('gemma-4')) return { model: google(modelId), providerOptions: { google: { chatTemplateKwargs: { enable_thinking: true } } } as ProviderOptions }
  if (modelId.includes('thinking') || modelId.includes('pro')) return { model: google(modelId), providerOptions: { google: { thinkingConfig: { thinkingLevel: 'auto', includeThoughts: true } } } as ProviderOptions }
  return { model: google(modelId), providerOptions: {} }
}
