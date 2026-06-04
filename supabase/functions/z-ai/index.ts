import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, corsHeaders } from '../_shared/handler.ts'

serve(
  createHandler(async (req, env) => {
    if (req.method === 'OPTIONS') {
       return new Response('ok', { headers: corsHeaders })
    }

    // Enforce strict environment variables - NO HARDCODING
    const activeApiKey = env['Z_AI_API_KEY']
    if (!activeApiKey) {
      return errorResponse('Server Configuration Error: Z_AI_API_KEY is missing.', 500)
    }

    let reqBodyText = ""
    try {
      if (req.method === 'POST') {
        reqBodyText = await req.text()
      }
    } catch (err) {
      // Ignored
    }

    // Hardcoded target URL just like generate-title to avoid routing bugs
    const targetUrl = 'https://api.z.ai/api/paas/v4/chat/completions'

    const cleanHeaders = new Headers()
    cleanHeaders.set('Authorization', `Bearer ${activeApiKey}`)
    const contentType = req.headers.get('content-type')
    if (contentType) cleanHeaders.set('Content-Type', contentType)
    const accept = req.headers.get('accept')
    if (accept) cleanHeaders.set('Accept', accept)

    try {
      const res = await fetch(targetUrl, {
        method: req.method,
        headers: cleanHeaders,
        body: reqBodyText || undefined
      })

      const resHeaders = new Headers(res.headers)
      Object.entries(corsHeaders).forEach(([k, v]) => resHeaders.set(k, v))

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders
      })
    } catch (err: any) {
      console.error('Fetch error during z-ai proxy:', err)
      return errorResponse('Z.AI API request failed', 502)
    }
  })
)
