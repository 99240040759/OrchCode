import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, jsonResponse } from '../_shared/handler.ts'

// Each entry: [envKeyPrefix, defaultId, defaultName]
// Env vars follow the pattern: <PREFIX>_MODEL_ID and <PREFIX>_MODEL_NAME
const MODEL_DEFINITIONS = [
  ['GEMINI',           'gemini-3.5-flash',              'Gemini 3.5 Flash (Fastest)'],
  ['GEMMA',            'gemma-4-26b-a4b-it',            'Gemma 4 26B (Unlimited)'],
  ['KIMI',             'nvidia/moonshotai/kimi-k2.6',     'Kimi K2.6 (Creative)'],
  ['OPENAI_GPT_OSS',   'nvidia/openai/gpt-oss-120b',      'GPT-OSS 120B (Medium)'],
  ['GLM_4_5_FLASH',    'zai/GLM-4.5-Flash',             'GLM 4.5 Flash (Thinking)'],
  ['GLM_4_6V_FLASH',   'zai/GLM-4.6V-Flash',            'GLM 4.6V Flash (Adaptive)'],
  ['DEEPSEEK_FLASH',   'opencode/deepseek-v4-flash-free', 'DeepSeek V4 Pro (Thinking)'],
  ['BIG_PICKLE',       'opencode/big-pickle',             'Big Pickle (Unlimited)'],
  ['MIMO_FREE',        'opencode/mimo-v2.5-free',             'MiMo V2.5 (Fast)'],
] as const

serve(createHandler(async (_req, env) => {
  const models: Record<string, { id: string; name: string; capabilities: { vision: boolean; nativeFiles: boolean } }> = {}
  for (const [prefix, defaultId, defaultName] of MODEL_DEFINITIONS) {
    const responseKey = prefix.toLowerCase()
    const id = env[`${prefix}_MODEL_ID`] || defaultId
    const name = env[`${prefix}_MODEL_NAME`] || defaultName
    const lid = id.toLowerCase()
    const vision = lid.includes('gemini') || lid.includes('gemma') || lid.includes('kimi') || lid.includes('mimo') || lid.includes('glm-4.6v')
    const nativeFiles = lid.includes('gemini')
    models[responseKey] = { id, name, capabilities: { vision, nativeFiles } }
  }
  return jsonResponse(models)
}))
