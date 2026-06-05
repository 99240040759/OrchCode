import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, proxyRequest } from '../_shared/handler.ts'

const TARGET_URL = 'https://api.z.ai/api/paas/v4/chat/completions'

serve(createHandler(async (req, env) => {
  const apiKey = env['Z_AI_API_KEY']
  if (!apiKey) return errorResponse('Server Configuration Error: Z_AI_API_KEY is missing.', 500)

  let body = ''
  if (req.method === 'POST') {
    try { body = await req.text() } catch { /* ignore */ }
  }

  return proxyRequest(req, TARGET_URL, { Authorization: `Bearer ${apiKey}` }, body)
}))
