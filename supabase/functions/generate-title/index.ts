import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, jsonResponse } from '../_shared/handler.ts'

serve(
  createHandler(async (req, env) => {
    if (req.method !== 'POST') {
      return errorResponse('Method Not Allowed', 405)
    }

    let text = ''
    try {
      const body = await req.json()
      text = body.text || ''
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    if (!text.trim()) {
      return jsonResponse({ title: 'New Conversation' })
    }

    const activeApiKey = env['NVIDIA_API_KEY']
    if (!activeApiKey) {
      return errorResponse('Server Configuration Error: NVIDIA_API_KEY is missing.', 500)
    }

    const payload = {
      model: 'meta/llama-3.2-1b-instruct',
      messages: [
        {
          role: 'user',
          content: `Generate a short 3-6 word title for this conversation. No quotes, no punctuation at end. Just the title.\n\n${text.slice(0, 3000)}`
        }
      ],
      temperature: 0.2,
      top_p: 0.7,
      max_tokens: 1024,
      stream: false
    }

    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        console.error(`Nvidia API error: ${res.status} ${res.statusText}`)
        const errText = await res.text()
        console.error(errText)
        return jsonResponse({ title: 'New Conversation' }) // Fallback title
      }

      const data = await res.json()
      let title = data.choices?.[0]?.message?.content?.trim() || 'New Conversation'
      
      // Clean up common AI title generation artifacts
      title = title.replace(/^"|"$/g, '')
      title = title.replace(/\.$/, '')
      
      return jsonResponse({ title })
    } catch (err: any) {
      console.error('Fetch error during title generation:', err)
      return jsonResponse({ title: 'New Conversation' })
    }
  })
)
