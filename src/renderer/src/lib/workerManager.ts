import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'

let sharedWorkerInstance: Worker | null = null
let sharedWorkerApi: any = null

export function getSharedWorker(): any {
  if (sharedWorkerApi) return sharedWorkerApi

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
