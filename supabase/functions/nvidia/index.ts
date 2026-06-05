import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createHandler, createOpenAICompatProxy } from '../_shared/handler.ts'

serve(createHandler(createOpenAICompatProxy({
  functionName: 'nvidia',
  envKey: 'NVIDIA_API_KEY',
  baseUrl: 'https://integrate.api.nvidia.com'
})))
