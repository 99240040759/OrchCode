import * as Comlink from 'comlink'
import BackgroundWorker from '../workers/background.worker?worker'

let sharedWorkerInstance: Worker | null = null
let sharedWorkerApi: any = null
// #28 fix: track the in-flight init promise to avoid fire-and-forget
let initPromise: Promise<void> | null = null

export function getSharedWorker(): any {
  if (sharedWorkerApi) return sharedWorkerApi

  try {
    sharedWorkerInstance = new BackgroundWorker()
    sharedWorkerApi = Comlink.wrap(sharedWorkerInstance)

    // Sync client ID for telemetry — await the init call so the worker is
    // ready before any callers use it. Store the promise so repeated calls
    // to getSharedWorker() while init is pending reuse the same promise.
    const clientId = localStorage.getItem('orchcode_client_id')
    if (clientId && sharedWorkerApi.init) {
      initPromise = (sharedWorkerApi.init(clientId) as Promise<void>).catch((err: any) => {
        console.error('[workerManager] Worker init failed:', err)
      })
    }
  } catch (err) {
    console.error('[workerManager] Failed to spawn background Comlink worker:', err)
    return null
  }

  return sharedWorkerApi
}

/** Wait for the worker's init() to resolve before calling worker methods. */
export async function waitForWorkerReady(): Promise<void> {
  if (initPromise) await initPromise
}

export function terminateSharedWorker(): void {
  if (sharedWorkerApi) {
    try { (sharedWorkerApi as any)[Comlink.releaseProxy]?.() } catch {}
    sharedWorkerApi = null
    initPromise = null
  }
  if (sharedWorkerInstance) {
    try { sharedWorkerInstance.terminate() } catch {}
    sharedWorkerInstance = null
  }
}
