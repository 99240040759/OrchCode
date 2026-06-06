import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, proxyRequest } from '../_shared/handler.ts'

const TARGET_URL = 'https://api.z.ai/api/paas/v4/chat/completions'

serve(createHandler(async (req, env) => {
  const apiKey = env['Z_AI_API_KEY']
  if (!apiKey) return errorResponse('Server Configuration Error: Z_AI_API_KEY is missing.', 500)
  const url = new URL(req.url), subpath = url.pathname.replace(/^\/(functions\/v1\/)?z-ai/, '')
  if (subpath !== '/v1/chat/completions') return errorResponse(`Path not allowed: ${subpath}`, 403)
  if (req.method !== 'POST') return errorResponse(`Method not allowed: ${req.method}`, 405)
  let body = ''
  try { body = await req.text() } catch { /* ignore */ }
  return proxyRequest(req, TARGET_URL, { Authorization: `Bearer ${apiKey}` }, body)
}))
