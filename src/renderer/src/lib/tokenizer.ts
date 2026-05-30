import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'

let tokenWorkerApi: any = null
try {
  const worker = new BackgroundWorker()
  tokenWorkerApi = Comlink.wrap(worker)
} catch (err) {
  console.error('[tokenizer] Failed to spawn Comlink token worker:', err)
}

export async function estimateTokens(text: string): Promise<number> {
  if (!text) return 0
  if (!tokenWorkerApi) return Math.ceil(text.length / 4)
  try {
    return await tokenWorkerApi.estimateTokens(text)
  } catch (err) {
    console.error('[tokenizer] Off-thread BPE estimation failed, falling back to char approximation:', err)
    return Math.ceil(text.length / 4)
  }
}
