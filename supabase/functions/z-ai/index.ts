import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, createOpenAICompatProxy } from '../_shared/handler.ts'

serve(createHandler(createOpenAICompatProxy({
  functionName: 'z-ai',
  envKey: 'Z_AI_API_KEY',
  baseUrl: 'https://api.z.ai/api/paas',
  pathReplace: { search: /^\/v1\//, replace: '/v4/' }
})))
