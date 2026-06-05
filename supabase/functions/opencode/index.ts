import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, createOpenAICompatProxy } from '../_shared/handler.ts'

serve(createHandler(createOpenAICompatProxy({
  functionName: 'opencode',
  envKey: 'OPENCODE_API_KEY',
  baseUrl: 'https://opencode.ai/zen'
})))
