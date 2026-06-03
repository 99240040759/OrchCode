import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'

let sharedWorkerInstance: Worker | null = null
let sharedWorkerApi: any = null

let workerInitFailed = false

export function getSharedWorker(): any {
  if (sharedWorkerApi) return sharedWorkerApi
  // Don't retry after a spawn failure — return null consistently
  if (workerInitFailed) return null

  try {
    sharedWorkerInstance = new BackgroundWorker()
    sharedWorkerApi = Comlink.wrap(sharedWorkerInstance as Worker)

    const clientId =
      typeof localStorage !== 'undefined' ? localStorage.getItem('orchcode_client_id') : null

    if (clientId && sharedWorkerApi.init) {
      ;(sharedWorkerApi.init(clientId) as Promise<void>).catch((err: any) => {
        console.error('[workerManager] Worker init failed:', err)
      })
    }
  } catch (err) {
    console.error('[workerManager] Failed to spawn background Comlink worker:', err)
    workerInitFailed = true
    sharedWorkerInstance = null
    sharedWorkerApi = null
    return null
  }

  return sharedWorkerApi
}

export function terminateSharedWorker(): void {
  if (sharedWorkerInstance) {
    try {
      sharedWorkerInstance.terminate()
    } catch (err) {
      console.error('[workerManager] Failed to terminate worker:', err)
    }
    sharedWorkerInstance = null
    sharedWorkerApi = null
  }
}
