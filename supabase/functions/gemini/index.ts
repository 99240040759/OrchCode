import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, proxyRequest } from '../_shared/handler.ts'

// Only specific Gemini model endpoints are proxied — no open forwarding.
const ALLOWED_PATH_PATTERNS = [
  /^\/v1beta\/models$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:­\-]+[/:]generateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:­\-]+[/:]streamGenerateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9_.:­\-]+[/:]countTokens$/
]

serve(createHandler(async (req, env) => {
  const apiKey = env['GOOGLE_GENERATIVE_AI_API_KEY']
  if (!apiKey) return errorResponse('Server Configuration Error: GOOGLE_GENERATIVE_AI_API_KEY is missing.', 500)

  const url = new URL(req.url)
  const subpath = url.pathname.replace(/^\/(functions\/v1\/)?gemini/, '')

  if (!ALLOWED_PATH_PATTERNS.some((p) => p.test(subpath))) {
    return errorResponse(`Path not allowed: ${subpath}`, 403)
  }

  return proxyRequest(
    req,
    `https://generativelanguage.googleapis.com${subpath}${url.search}`,
    { 'x-goog-api-key': apiKey }  // Gemini uses key header, not Bearer
  )
}))
