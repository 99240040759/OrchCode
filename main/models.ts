import log from 'electron-log'
import OpenAI from 'openai'
import type { Stream } from 'openai/streaming'
import { requireAuthToken } from './auth'
import { getApiBaseUrl, globalApiLimiter } from './utils'
import { zodToJsonSchema } from 'zod-to-json-schema'

// provider field added — now populated from /models response (set by server)
export interface ModelInfo { id: string; name: string; multimodal: boolean; contextWindow?: number; badge?: string | null; provider?: string; reasoningEffort?: string | null }
export type AvailableModels = Record<string, ModelInfo>

let cachedModels: AvailableModels | null = null
let cachedModelsAt = 0
const MODELS_TTL_MS = 5 * 60 * 1000
// Secondary index: model.id → ModelInfo for O(1) lookup (avoids O(n) find() on every stream call)
let modelIdIndex = new Map<string, ModelInfo>()

export function createAuthFetch(useAnon = false, extra?: Record<string, string>) {
  return (url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers || {})
    headers.set('Authorization', `Bearer ${useAnon ? process.env.SUPABASE_ANON_KEY! : requireAuthToken()}`)
    headers.set('apikey', process.env.SUPABASE_ANON_KEY!)
    if (extra) { for (const [k, v] of Object.entries(extra)) headers.set(k, v) }
    return fetch(url, { ...options, headers })
  }
}

export async function getAvailableModels(force = false): Promise<AvailableModels> {
  if (!force && cachedModels && Date.now() - cachedModelsAt < MODELS_TTL_MS) return cachedModels
  const response = await createAuthFetch(true)(`${getApiBaseUrl()}/models`)
  if (!response.ok) throw new Error(`Failed to fetch models: HTTP ${response.status}`)
  cachedModels = await response.json(); cachedModelsAt = Date.now()
  modelIdIndex = new Map(Object.values(cachedModels!).map(m => [m.id, m]))
  return cachedModels!
}

export function getOpenAiTools(toolsRecord: Record<string, any>) {
  const list: any[] = []
  for (const [name, toolObj] of Object.entries(toolsRecord)) {
    const jsonSchema = zodToJsonSchema(toolObj.parameters || toolObj.inputSchema, { target: 'openAi' })
    list.push({ type: 'function', function: { name, description: toolObj.description || '', parameters: jsonSchema } })
  }
  return list
}

// Provider → base URL mapping. Server owns routing; client just reads model.provider.
const PROVIDER_BASE: Record<string, string> = {
  nvidia:   'nvidia/v1',
  opencode: 'opencode/v1',
  'z-ai':   'z-ai/v1',
}

// Cache OpenAI clients by baseUrl — avoids constructing a new instance on every LLM call
const openaiClientCache = new Map<string, OpenAI>()
function getOpenAiClient(baseUrl: string): OpenAI {
  let client = openaiClientCache.get(baseUrl)
  if (!client) {
    client = new OpenAI({ apiKey: requireAuthToken(), baseURL: baseUrl, defaultHeaders: { 'apikey': process.env.SUPABASE_ANON_KEY! }, timeout: 30 * 60 * 1000, maxRetries: 1 })
    openaiClientCache.set(baseUrl, client)
  } else {
    // Refresh apiKey in case token rotated since client was created
    ;(client as any).apiKey = requireAuthToken()
  }
  return client
}

export async function streamLlmResponse(
  modelId: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  systemInstruction?: string,
  tools?: any,
  abortSignal?: AbortSignal,
  prevInputTokens = 0
): Promise<Stream<OpenAI.Chat.ChatCompletionChunk>> {
  const models = await getAvailableModels()
  // O(1) indexed lookup — avoids O(n) Array.find() + fallback key scan on every call
  const rawModel = modelIdIndex.get(modelId) ?? models[modelId]
  if (!rawModel) throw new Error(`Requested model "${modelId}" is not available.`)
  const apiBase = getApiBaseUrl()
  const providerPath = PROVIDER_BASE[rawModel.provider ?? 'opencode'] ?? PROVIDER_BASE.opencode
  const baseUrl = `${apiBase}/${providerPath}`
  const modelName = rawModel.id.split('/').slice(1).join('/')
  log.info(`[models] ${modelId} → provider=${rawModel.provider} baseUrl=${baseUrl} modelName=${modelName}`)
  const openai = getOpenAiClient(baseUrl)
  const openAiMessages = [...messages]
  if (systemInstruction) openAiMessages.unshift({ role: 'system', content: systemInstruction })
  const openAiTools = tools ? getOpenAiTools(tools) : undefined
  const payload: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
    model: modelName, messages: openAiMessages,
    tools: openAiTools?.length ? openAiTools : undefined,
    tool_choice: openAiTools?.length ? 'auto' : undefined,
    temperature: 0.35, max_tokens: 32768,
    frequency_penalty: 0, presence_penalty: 0,
    stream: true, stream_options: { include_usage: true },
  }
  return globalApiLimiter.schedule(() => {
    // Attach prev-prompt-tokens header so GCP proxyWithBudget records only the incremental delta
    const extraHeaders = prevInputTokens > 0 ? { 'x-prev-prompt-tokens': String(prevInputTokens) } : {}
    return openai.chat.completions.create(payload, { signal: abortSignal, headers: extraHeaders })
  }) as Promise<Stream<OpenAI.Chat.ChatCompletionChunk>>
}
