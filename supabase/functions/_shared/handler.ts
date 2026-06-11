/**
 * Shared edge function middleware.
 * CORS, auth, env loading, error handling, and proxy utilities — all in one place.
 */
import { validateAnonKey, validateUserJWT, timingSafeEqual } from './auth.ts'

export const ALLOWED_ORIGIN = 'app://orch-code'

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

export type EnvMap = Record<string, string>
export type HandlerFn = (req: Request, env: EnvMap) => Promise<Response>

/** Wraps an edge function handler with CORS, auth, and error handling. */
export function createHandler(fn: HandlerFn) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }

    const expectedAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : ''

    if (!expectedAnonKey || !supabaseUrl) {
      return errorResponse('Server Configuration Error: Configuration parameters are missing.', 500)
    }

    const url = new URL(req.url)
    const isPublic = url.pathname === '/functions/v1/api/models' || url.pathname === '/api/models'

    if (isPublic) {
      if (!validateAnonKey(req, expectedAnonKey)) {
        return errorResponse('Unauthorized Client', 401)
      }
    } else {
      const apiKeyHeader = req.headers.get('apikey')
      if (!apiKeyHeader || !timingSafeEqual(apiKeyHeader.trim(), expectedAnonKey.trim())) {
        return errorResponse('Unauthorized API Client', 401)
      }
      const user = await validateUserJWT(req, supabaseUrl, expectedAnonKey)
      if (!user) {
        return errorResponse('Unauthorized User: Invalid JWT', 401)
      }
    }

    const env: EnvMap = {}
    const envKeys = [
      'SUPABASE_ANON_KEY', 'SUPABASE_URL',
      'GOOGLE_GENERATIVE_AI_API_KEY', 'TAVILY_API_KEY',
      'NVIDIA_API_KEY', 'OPENCODE_API_KEY', 'Z_AI_API_KEY',
      'GEMINI_MODEL_ID', 'GEMINI_MODEL_NAME',
      'GEMMA_MODEL_ID', 'GEMMA_MODEL_NAME',
      'KIMI_MODEL_ID', 'KIMI_MODEL_NAME',
      'GLM_4_5_FLASH_MODEL_ID', 'GLM_4_5_FLASH_MODEL_NAME',
      'DEEPSEEK_FLASH_MODEL_ID', 'DEEPSEEK_FLASH_MODEL_NAME',
      'BIG_PICKLE_MODEL_ID', 'BIG_PICKLE_MODEL_NAME',
      'MIMO_FREE_MODEL_ID', 'MIMO_FREE_MODEL_NAME'
    ]
    for (const key of envKeys) {
      const val = Deno.env.get(key)
      if (val) env[key] = val
    }
    if (projectRef) env['PROJECT_REF'] = projectRef

    try {
      return await fn(req, env)
    } catch (err: any) {
      console.error('[handler] Unhandled error:', err)
      return errorResponse(err?.message || 'Internal Server Error', 500)
    }
  }
}

export function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// ─── Proxy utilities ──────────────────────────────────────────────────────────

/** Builds clean outbound headers, forwarding content-type and accept from the request. */
function buildForwardHeaders(req: Request, authHeader: Record<string, string>): Headers {
  const h = new Headers(authHeader)
  const ct = req.headers.get('content-type')
  if (ct) h.set('Content-Type', ct)
  const acc = req.headers.get('accept')
  if (acc) h.set('Accept', acc)
  const ua = req.headers.get('user-agent')
  if (ua) h.set('User-Agent', ua)
  const origin = req.headers.get('origin')
  if (origin) h.set('Origin', origin)
  const referer = req.headers.get('referer') || req.headers.get('http-referer')
  if (referer) h.set('Referer', referer)
  return h
}

/** Merges CORS headers into upstream response and streams body back. */
function upstreamResponse(res: Response): Response {
  const resHeaders = new Headers(res.headers)
  Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v))
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: resHeaders })
}

/**
 * Generic proxy: forwards the request to targetUrl with the given auth header,
 * streams the upstream response back with CORS headers merged.
 */
export async function proxyRequest(
  req: Request,
  targetUrl: string,
  authHeader: Record<string, string>,
  body?: string
): Promise<Response> {
  const headers = buildForwardHeaders(req, authHeader)
  try {
    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body !== undefined ? (body || undefined) : req.body
    })
    return upstreamResponse(res)
  } catch (err: any) {
    return errorResponse(`Upstream Proxy Error (${targetUrl}): ${err.message || 'fetch failed'}`, 502)
  }
}

/**
 * Factory for OpenAI-compatible proxy functions (Bearer auth, /v1/models + /v1/chat/completions).
 * nvidia, opencode, z-ai are all identical except for their base URL, env key, and function name.
 *
 * Usage:
 *   serve(createHandler(createOpenAICompatProxy({
 *     functionName: 'nvidia',
 *     envKey: 'NVIDIA_API_KEY',
 *     baseUrl: 'https://integrate.api.nvidia.com'
 *   })))
 */
export interface OpenAICompatConfig {
  functionName: string    // used for path-stripping: /functions/v1/<functionName>
  envKey: string          // env var holding the API key
  baseUrl: string         // upstream base URL (no trailing slash)
  pathReplace?: { search: string | RegExp; replace: string }
}

const OPENAI_COMPAT_PATHS = [/^\/v1\/models$/, /^\/v1\/chat\/completions$/]

export function createOpenAICompatProxy(config: OpenAICompatConfig): HandlerFn {
  return async (req: Request, env: EnvMap): Promise<Response> => {
    const apiKey = env[config.envKey]
    if (!apiKey) return errorResponse(`Server Configuration Error: ${config.envKey} is missing.`, 500)
    const url = new URL(req.url)
    const subpath = url.pathname.replace(new RegExp(`^/(functions/v1/)?${config.functionName}`), '')
    if (!OPENAI_COMPAT_PATHS.some((p) => p.test(subpath))) return errorResponse(`Path not allowed: ${subpath}`, 403)
    let body = ''
    if (req.method === 'POST' && subpath === '/v1/chat/completions') {
      try { body = await req.text() } catch { /* fallback to empty */ }
    }
    const targetPath = config.pathReplace ? subpath.replace(config.pathReplace.search, config.pathReplace.replace) : subpath
    return proxyRequest(req, `${config.baseUrl}${targetPath}${url.search}`, { Authorization: `Bearer ${apiKey}` }, body)
  }
}
