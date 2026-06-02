/**
 * HIGH-12 FIX: Shared edge function middleware.
 * Previously each of the 3 functions copy-pasted 15+ lines of:
 * CORS headers, env validation, anon key auth, error handling.
 * This single wrapper eliminates all that duplication.
 */
import { validateAnonKey } from './auth.ts'

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

    if (!expectedAnonKey) {
      return errorResponse('Server Configuration Error: SUPABASE_ANON_KEY is missing.', 500)
    }

    if (!validateAnonKey(req, expectedAnonKey)) {
      return errorResponse('Unauthorized', 401)
    }

    // Build env map for handler
    const env: EnvMap = {}
    const envKeys = [
      'SUPABASE_ANON_KEY',
      'SUPABASE_URL',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'TAVILY_API_KEY',
      'NVIDIA_API_KEY'
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
  const isJson = status >= 400
  return new Response(isJson ? JSON.stringify({ error: message }) : message, {
    status,
    headers: {
      ...corsHeaders,
      ...(isJson ? { 'Content-Type': 'application/json' } : {})
    }
  })
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
