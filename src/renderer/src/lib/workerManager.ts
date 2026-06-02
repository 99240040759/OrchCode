import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'

let sharedWorkerInstance: Worker | null = null
let sharedWorkerApi: any = null

export function getSharedWorker(): any {
  if (sharedWorkerApi) return sharedWorkerApi

  try {
    sharedWorkerInstance = new BackgroundWorker()
    sharedWorkerApi = Comlink.wrap(sharedWorkerInstance)

    // Sync client ID for telemetry
    // MINOR-7: Guard localStorage access — may be unavailable in sandboxed contexts
    const clientId = typeof localStorage !== 'undefined'
      ? localStorage.getItem('orchcode_client_id')
      : null

    if (clientId && sharedWorkerApi.init) {
      (sharedWorkerApi.init(clientId) as Promise<void>).catch((err: any) => {
        console.error('[workerManager] Worker init failed:', err)
      })
    }
  } catch (err) {
    console.error('[workerManager] Failed to spawn background Comlink worker:', err)
    return null
  }

  return sharedWorkerApi
}

/**
 * ARCH-3: Terminate the background worker and clear singleton state.
 * Call this on renderer cleanup (e.g. app:before-quit) to avoid orphaned worker threads.
 */
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
