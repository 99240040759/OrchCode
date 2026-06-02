import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, jsonResponse, errorResponse } from '../_shared/handler.ts'

// MED-6 FIX: Model IDs/names now read from environment variables,
// no longer hardcoded. Change models without redeploying the function.
// Set GEMINI_MODEL_ID, GEMINI_MODEL_NAME, GEMMA_MODEL_ID, GEMMA_MODEL_NAME in Supabase secrets.
const DEFAULT_GEMINI_ID = 'gemini-3.1-flash-lite'
const DEFAULT_GEMINI_NAME = 'Gemini 3.1 Flash Lite (Fastest)'
const DEFAULT_GEMMA_ID = 'gemma-4-31b-it'
const DEFAULT_GEMMA_NAME = 'Gemma 4 31B (Thinking)'
const DEFAULT_KIMI_ID = 'nvidia/moonshotai/kimi-k2.6'
const DEFAULT_KIMI_NAME = 'Kimi K2.6 (Fast Think)'
const DEFAULT_MINIMAX_ID = 'nvidia/minimaxai/minimax-m2.7'
const DEFAULT_MINIMAX_NAME = 'Minimax M2.7 (Slowest)'
const DEFAULT_GLM_ID = 'nvidia/z-ai/glm-5.1'
const DEFAULT_GLM_NAME = 'GLM 5.1 (Slow)'

serve(
  createHandler(async (_req, env) => {
    const gemini = {
      id: env['GEMINI_MODEL_ID'] || DEFAULT_GEMINI_ID,
      name: env['GEMINI_MODEL_NAME'] || DEFAULT_GEMINI_NAME
    }
    const gemma = {
      id: env['GEMMA_MODEL_ID'] || DEFAULT_GEMMA_ID,
      name: env['GEMMA_MODEL_NAME'] || DEFAULT_GEMMA_NAME
    }
    const kimi = {
      id: env['KIMI_MODEL_ID'] || DEFAULT_KIMI_ID,
      name: env['KIMI_MODEL_NAME'] || DEFAULT_KIMI_NAME
    }
    const minimax = {
      id: env['MINIMAX_MODEL_ID'] || DEFAULT_MINIMAX_ID,
      name: env['MINIMAX_MODEL_NAME'] || DEFAULT_MINIMAX_NAME
    }
    const glm = {
      id: env['GLM_MODEL_ID'] || DEFAULT_GLM_ID,
      name: env['GLM_MODEL_NAME'] || DEFAULT_GLM_NAME
    }

    return jsonResponse({ gemini, gemma, kimi, minimax, glm })
  })
)
