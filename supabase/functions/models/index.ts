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
const DEFAULT_GLM_4_5_FLASH_ID = 'zai/GLM-4.5-Flash'
const DEFAULT_GLM_4_5_FLASH_NAME = 'GLM 4.5 Flash (Thinking)'
const DEFAULT_GLM_4_6V_FLASH_ID = 'zai/GLM-4.6V-Flash'
const DEFAULT_GLM_4_6V_FLASH_NAME = 'GLM 4.6V Flash (Vision)'
const DEFAULT_DEEPSEEK_FLASH_ID = 'opencode/deepseek-v4-flash-free'
const DEFAULT_DEEPSEEK_FLASH_NAME = 'DeepSeek V4 Pro (Thinking)'
const DEFAULT_BIG_PICKLE_ID = 'opencode/big-pickle'
const DEFAULT_BIG_PICKLE_NAME = 'Big Pickle (Unlimited)'
const DEFAULT_MIMO_FREE_ID = 'opencode/mimo-v2.5-free'
const DEFAULT_MIMO_FREE_NAME = 'MiMo V2.5 (Fast)'

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
    const glm_4_5_flash = {
      id: env['GLM_4_5_FLASH_MODEL_ID'] || DEFAULT_GLM_4_5_FLASH_ID,
      name: env['GLM_4_5_FLASH_MODEL_NAME'] || DEFAULT_GLM_4_5_FLASH_NAME
    }
    const glm_4_6v_flash = {
      id: env['GLM_4_6V_FLASH_MODEL_ID'] || DEFAULT_GLM_4_6V_FLASH_ID,
      name: env['GLM_4_6V_FLASH_MODEL_NAME'] || DEFAULT_GLM_4_6V_FLASH_NAME
    }
    const deepseek_flash = {
      id: env['DEEPSEEK_FLASH_MODEL_ID'] || DEFAULT_DEEPSEEK_FLASH_ID,
      name: env['DEEPSEEK_FLASH_MODEL_NAME'] || DEFAULT_DEEPSEEK_FLASH_NAME
    }
    const big_pickle = {
      id: env['BIG_PICKLE_MODEL_ID'] || DEFAULT_BIG_PICKLE_ID,
      name: env['BIG_PICKLE_MODEL_NAME'] || DEFAULT_BIG_PICKLE_NAME
    }
    const mimo_free = {
      id: env['MIMO_FREE_MODEL_ID'] || DEFAULT_MIMO_FREE_ID,
      name: env['MIMO_FREE_MODEL_NAME'] || DEFAULT_MIMO_FREE_NAME
    }

    return jsonResponse({
      gemini,
      gemma,
      kimi,
      glm_4_5_flash,
      glm_4_6v_flash,
      deepseek_flash,
      big_pickle,
      mimo_free
    })
  })
)
