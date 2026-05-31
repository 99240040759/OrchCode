import { getSharedWorker } from './workerManager'

export async function estimateTokens(text: string): Promise<number> {
  if (!text) return 0
  const workerApi = getSharedWorker()
  if (!workerApi) return Math.ceil(text.length / 4)
  try {
    return await workerApi.estimateTokens(text)
  } catch (err) {
    console.error('[tokenizer] Off-thread BPE estimation failed, falling back to char approximation:', err)
    return Math.ceil(text.length / 4)
  }
}
