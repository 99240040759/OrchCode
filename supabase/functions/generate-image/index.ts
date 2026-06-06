import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, errorResponse, jsonResponse } from '../_shared/handler.ts'

serve(
  createHandler(async (req, env) => {
    if (req.method !== 'POST') {
      return errorResponse('Method Not Allowed', 405)
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400)
    }

    const { prompt, width = 1024, height = 1024, seed = 0, steps = 4 } = body

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return errorResponse('Missing or invalid prompt parameter', 400)
    }

    const activeApiKey = env['NVIDIA_API_KEY']
    if (!activeApiKey) {
      return errorResponse('Server Configuration Error: NVIDIA_API_KEY is missing.', 500)
    }

    const invokeUrl = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b'

    const payload = {
      prompt: prompt.trim(),
      width: Number(width),
      height: Number(height),
      seed: Number(seed),
      steps: Number(steps)
    }

    try {
      console.log(`[generate-image] Invoking NVIDIA FLUX API for prompt: "${payload.prompt.slice(0, 50)}..."`)
      const res = await fetch(invokeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error(`Nvidia API error: ${res.status} ${res.statusText}`, errText)
        return errorResponse(`Nvidia invocation failed with status ${res.status}: ${errText}`, 502)
      }

      const data = await res.json()
      return jsonResponse(data)
    } catch (err: any) {
      console.error('Fetch error during image generation proxy:', err)
      return errorResponse(err?.message || 'Error communicating with Nvidia FLUX API', 500)
    }
  })
)
