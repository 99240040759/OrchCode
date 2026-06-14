import log from 'electron-log'
import OpenAI from 'openai'
import { requireAuthToken } from './auth'
import { getApiBaseUrl, globalApiLimiter } from './utils'

export interface ModelInfo { id: string; name: string; multimodal: boolean; contextWindow?: number; badge?: string | null }
export type AvailableModels = Record<string, ModelInfo>


let cachedModels: AvailableModels | null = null
let cachedModelsAt = 0
const MODELS_TTL_MS = 5 * 60 * 1000

function createAuthFetch(useAnon = false, extra?: Record<string, string>) {
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
  return cachedModels!
}

function zodToJsonSchema(schema: any): any {
  if (!schema) return {}
  const def = schema._def || {}, typeName = def.typeName, description = schema.description || def.description
  let result: any = {}
  switch (typeName) {
    case 'ZodString': result = { type: 'string' }; break
    case 'ZodNumber': result = { type: 'number' }; break
    case 'ZodBoolean': result = { type: 'boolean' }; break
    case 'ZodEnum': result = { type: 'string', enum: def.values }; break
    case 'ZodOptional': case 'ZodNullable': case 'ZodDefault':
      result = zodToJsonSchema(def.innerType || def.schema); break
    case 'ZodEffects':
      result = zodToJsonSchema(def.schema || def.innerType); break
    case 'ZodArray':
      result = { type: 'array', items: zodToJsonSchema(schema.element || def.element) }; break
    case 'ZodObject': {
      const properties: Record<string, any> = {}, required: string[] = [], shape = schema.shape || def.shape || {}
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v)
        let isOpt = false, inner = v as any
        while (inner) {
          const innerDef = inner._def || {}, innerTypeName = innerDef.typeName
          if (innerTypeName === 'ZodOptional' || innerTypeName === 'ZodDefault') { isOpt = true; break }
          inner = innerDef.innerType || innerDef.schema
        }
        if (!isOpt) required.push(k)
      }
      result = { type: 'object', properties, ...(required.length ? { required } : {}) }; break
    }
    case 'ZodRecord': result = { type: 'object', additionalProperties: zodToJsonSchema(def.valueType) }; break
    default: result = {}
  }
  if (description) result.description = description
  return result
}
export function getOpenAiTools(toolsRecord: Record<string, any>) {
  const list: any[] = []
  for (const [name, toolObj] of Object.entries(toolsRecord)) {
    const jsonSchema = zodToJsonSchema(toolObj.parameters || toolObj.inputSchema)
    list.push({ type: 'function', function: { name, description: toolObj.description || '', parameters: jsonSchema } })
  }
  return list
}
export async function streamLlmResponse(
  modelId: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  systemInstruction?: string,
  tools?: any,
  abortSignal?: AbortSignal
): Promise<any> {
  const models = await getAvailableModels()
  const rawModel = Object.values(models).find(m => m.id === modelId) || models[modelId]
  if (!rawModel) throw new Error(`Requested model "${modelId}" is not available.`)
  let baseUrl = '', modelName = rawModel.id
  const apiBase = getApiBaseUrl()
  if (rawModel.id.startsWith('zai/')) {
    baseUrl = `${apiBase}/z-ai/v1`
    modelName = rawModel.id.replace('zai/', '')
  } else if (rawModel.id.startsWith('opencode/')) {
    baseUrl = `${apiBase}/opencode/v1`
    modelName = rawModel.id.replace('opencode/', '')
  } else if (rawModel.id.startsWith('nvidia/')) {
    baseUrl = `${apiBase}/nvidia/v1`
    modelName = rawModel.id.replace('nvidia/', '')
  } else {
    baseUrl = `${apiBase}/gemini/v1beta/openai`
  }
  log.info(`[custom-stream] Using OpenAI unified SDK for ${modelId}`)
  const openai = new OpenAI({
    apiKey: requireAuthToken(),
    baseURL: baseUrl,
    defaultHeaders: { 'apikey': process.env.SUPABASE_ANON_KEY! },
    timeout: 30 * 60 * 1000
  })
  const openAiMessages = [...messages]
  if (systemInstruction) { openAiMessages.unshift({ role: 'system', content: systemInstruction }) }
  const openAiTools = tools ? getOpenAiTools(tools) : undefined
  const payload: any = {
    model: modelName,
    messages: openAiMessages as any,
    tools: openAiTools?.length ? openAiTools : undefined,
    stream: true,
    stream_options: { include_usage: true }
  }
  // ── Per-model reasoning/thinking params ──────────────────────────────────
  // gemini-3.1-flash-lite: pure generation, no thinking params needed
  // gemma-4-26b-a4b-it: Google OpenAI-compat supports thinking_config via extra_body
  if (rawModel.id === 'gemma-4-26b-a4b-it') {
    payload.extra_body = { thinking_config: { thinking_budget: -1 } }
  // nvidia/moonshotai/kimi-k2.6: NVIDIA NIM enables thinking via chat_template_kwargs, not reasoning_effort
  } else if (rawModel.id === 'nvidia/moonshotai/kimi-k2.6') {
    payload.extra_body = { chat_template_kwargs: { thinking: true, enable_thinking: true } }
  // zai/GLM-4.5-Flash: bigmodel.cn uses enable_thinking; clear_thinking=false preserves reasoning across tool turns
  } else if (rawModel.id.startsWith('zai/')) {
    payload.extra_body = { chat_template_kwargs: { enable_thinking: true, clear_thinking: false } }
  // opencode/*: DeepSeek/Nemotron/MiMo/Big Pickle — reasoning_effort max; unsupported models ignore it
  } else if (rawModel.id.startsWith('opencode/')) {
    payload.reasoning_effort = 'max'
  }
  return globalApiLimiter.schedule(() => openai.chat.completions.create(payload, { signal: abortSignal }))
}
