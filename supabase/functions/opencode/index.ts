import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, corsHeaders } from '../_shared/handler.ts'

const ALLOWED_PATH_PATTERNS = [/^\/v1\/models$/, /^\/v1\/chat\/completions$/]

function isAllowedPath(subpath: string): boolean {
  return ALLOWED_PATH_PATTERNS.some((p) => p.test(subpath))
}

serve(
  createHandler(async (req, env) => {
    const url = new URL(req.url)
    const subpath = url.pathname.replace(/^\/(functions\/v1\/)?opencode/, '')

    if (!isAllowedPath(subpath)) {
      return errorResponse(`Path not allowed: ${subpath}`, 403)
    }

    let reqBodyText = ""
    if (req.method === 'POST' && subpath === '/v1/chat/completions') {
      try {
        reqBodyText = await req.text()
      } catch (err) {
        // Ignored, fallback to empty body if missing
      }
    }

    const activeApiKey = env['OPENCODE_API_KEY']
    if (!activeApiKey) {
      return errorResponse('Server Configuration Error: OPENCODE_API_KEY is missing.', 500)
    }

    const targetUrl = `https://opencode.ai/zen${subpath}${url.search}`

    const cleanHeaders = new Headers()
    cleanHeaders.set('Authorization', `Bearer ${activeApiKey}`)
    const contentType = req.headers.get('content-type')
    if (contentType) cleanHeaders.set('Content-Type', contentType)
    const accept = req.headers.get('accept')
    if (accept) cleanHeaders.set('Accept', accept)

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
  })
)
