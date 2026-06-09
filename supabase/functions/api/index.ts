import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, jsonResponse, proxyRequest, createOpenAICompatProxy, EnvMap } from '../_shared/handler.ts'

// Gemini allowed path patterns
const GEMINI_PATH_PATTERNS = [
  /^\/v1beta\/models$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]generateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]streamGenerateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:\-]+[/:]countTokens$/
]

// Model Definitions
const MODEL_DEFINITIONS = [
  ['GEMMA',            'gemma-4-26b-a4b-it',            'Gemma 4 26B (Unlimited)'],
  ['KIMI',             'nvidia/moonshotai/kimi-k2.6',     'Kimi K2.6 (Creative)'],
  ['OPENAI_GPT_OSS',   'nvidia/openai/gpt-oss-120b',      'GPT-OSS 120B (Medium)'],
  ['GLM_4_5_FLASH',    'zai/GLM-4.5-Flash',             'GLM 4.5 Flash (Thinking)'],
  ['DEEPSEEK_FLASH',   'opencode/deepseek-v4-flash-free', 'DeepSeek V4 Pro (Thinking)'],
  ['BIG_PICKLE',       'opencode/big-pickle',             'Big Pickle (Unlimited)'],
  ['MIMO_FREE',        'opencode/mimo-v2.5-free',             'MiMo V2.5 (Fast)'],
] as const

// Tavily Config
const MAX_QUERY_LENGTH = 500
const MAX_RESULTS_LIMIT = 10
const DOMAIN_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/

// We wrap createOpenAICompatProxy because it returns a HandlerFn that takes (req, env)
const handleNvidia = createOpenAICompatProxy({ functionName: 'api/nvidia', envKey: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com' })
const handleOpencode = createOpenAICompatProxy({ functionName: 'api/opencode', envKey: 'OPENCODE_API_KEY', baseUrl: 'https://opencode.ai/zen' })
const handleZAi = createOpenAICompatProxy({ functionName: 'api/z-ai', envKey: 'Z_AI_API_KEY', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', pathReplace: { search: /^\/v1/, replace: '' } })

async function handleGemini(req: Request, env: EnvMap, url: URL): Promise<Response> {
  const apiKey = env['GOOGLE_GENERATIVE_AI_API_KEY']
  if (!apiKey) return errorResponse('Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.', 500)
  const subpath = url.pathname.replace(/^\/(functions\/v1\/)?api\/gemini/, '')
  if (!GEMINI_PATH_PATTERNS.some((p) => p.test(subpath))) return errorResponse(`Path not allowed: ${subpath}`, 403)
  return proxyRequest(req, `https://generativelanguage.googleapis.com${subpath}${url.search}`, { 'x-goog-api-key': apiKey })
}

async function handleModels(req: Request, env: EnvMap): Promise<Response> {
  const models: Record<string, { id: string; name: string; capabilities: { vision: boolean; nativeFiles: boolean } }> = {}
  for (const [prefix, defaultId, defaultName] of MODEL_DEFINITIONS) {
    const id = env[`${prefix}_MODEL_ID`] || defaultId
    let isAvailable = true
    if (id.startsWith('zai/') && !env['Z_AI_API_KEY']) isAvailable = false
    if (id.startsWith('opencode/') && !env['OPENCODE_API_KEY']) isAvailable = false
    if (id.startsWith('nvidia/') && !env['NVIDIA_API_KEY']) isAvailable = false
    if (!id.includes('/') && !env['GOOGLE_GENERATIVE_AI_API_KEY']) isAvailable = false // gemini/gemma

    if (isAvailable) {
      const responseKey = prefix.toLowerCase()
      const name = env[`${prefix}_MODEL_NAME`] || defaultName
      const lid = id.toLowerCase()
      const vision = lid.includes('gemini') || lid.includes('gemma') || lid.includes('kimi') || lid.includes('mimo') || lid.includes('glm-4.6v')
      const nativeFiles = lid.includes('gemini')
      models[responseKey] = { id, name, capabilities: { vision, nativeFiles } }
    }
  }
  return jsonResponse(models)
}

async function handleTavily(req: Request, env: EnvMap): Promise<Response> {
  const tavilyKey = env['TAVILY_API_KEY']
  if (!tavilyKey) return errorResponse('Server Configuration Error: TAVILY_API_KEY is missing.', 500)
  let body: any
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body.', 400) }
  const { query, domain, maxResults } = body
  if (!query || typeof query !== 'string' || query.trim().length === 0) return errorResponse("'query' is required and must be a non-empty string.", 400)
  if (query.length > MAX_QUERY_LENGTH) return errorResponse(`'query' must not exceed ${MAX_QUERY_LENGTH} characters.`, 400)
  if (domain !== undefined && domain !== null) {
    if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain)) return errorResponse("'domain' must be a valid domain name (e.g. example.com).", 400)
  }
  const resolvedMaxResults = Math.min(Math.max(1, Number.isInteger(maxResults) ? maxResults : 5), MAX_RESULTS_LIMIT)
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: tavilyKey, query: query.trim(), include_domains: domain ? [domain] : undefined, include_answer: true, max_results: resolvedMaxResults })
  })
  return jsonResponse(await response.json(), response.status)
}

async function handleGenerateTitle(req: Request, env: EnvMap): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('Method Not Allowed', 405)
  let text = ''
  try { const body = await req.json(); text = body.text || '' } catch { return errorResponse('Invalid JSON body', 400) }
  if (!text.trim()) return jsonResponse({ title: 'New Conversation' })
  const activeApiKey = env['NVIDIA_API_KEY']
  if (!activeApiKey) return errorResponse('Server Configuration Error: NVIDIA_API_KEY is missing.', 500)
  const payload = { model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: `Generate a short 3-6 word title for this conversation. No quotes, no punctuation at end. Just the title.\n\n${text.slice(0, 3000)}` }], temperature: 0.2, top_p: 0.7, max_tokens: 1024, stream: false }
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${activeApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) return jsonResponse({ title: 'New Conversation' })
    const data = await res.json()
    let title = data.choices?.[0]?.message?.content?.trim() || 'New Conversation'
    title = title.replace(/^"|"$/g, '').replace(/\.$/, '')
    return jsonResponse({ title })
  } catch (err) { return jsonResponse({ title: 'New Conversation' }) }
}

async function handleGenerateImage(req: Request, env: EnvMap): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('Method Not Allowed', 405)
  let body: any
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body', 400) }
  const { prompt, width = 1024, height = 1024, seed = 0, steps = 4 } = body
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) return errorResponse('Missing or invalid prompt parameter', 400)
  const activeApiKey = env['NVIDIA_API_KEY']
  if (!activeApiKey) return errorResponse('Server Configuration Error: NVIDIA_API_KEY is missing.', 500)
  const payload = { prompt: prompt.trim(), width: Number(width), height: Number(height), seed: Number(seed), steps: Number(steps) }
  try {
    const res = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b', { method: 'POST', headers: { 'Authorization': `Bearer ${activeApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const errText = await res.text(); return errorResponse(`Nvidia invocation failed with status ${res.status}: ${errText}`, 502) }
    return jsonResponse(await res.json())
  } catch (err: any) { return errorResponse(err?.message || 'Error communicating with Nvidia FLUX API', 500) }
}

serve(
  createHandler(async (req, env) => {
    const url = new URL(req.url)
    
    if (url.pathname.includes('/api/gemini')) return handleGemini(req, env, url)
    if (url.pathname.includes('/api/nvidia')) return handleNvidia(req, env)
    if (url.pathname.includes('/api/opencode')) return handleOpencode(req, env)
    if (url.pathname.includes('/api/z-ai')) return handleZAi(req, env)
    if (url.pathname.includes('/api/tavily')) return handleTavily(req, env)
    if (url.pathname.includes('/api/models')) return handleModels(req, env)
    if (url.pathname.includes('/api/generate-title')) return handleGenerateTitle(req, env)
    if (url.pathname.includes('/api/generate-image')) return handleGenerateImage(req, env)
    
    return errorResponse(`Not Found: ${url.pathname}`, 404)
  })
)
