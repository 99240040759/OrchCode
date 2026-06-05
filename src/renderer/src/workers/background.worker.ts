import { expose } from 'comlink'

// Background worker: runs off-thread to avoid blocking the renderer.
// Only does Mac update checks — telemetry has been removed.
const workerAPI = {
  async checkMacUpdate(): Promise<{ hasUpdate: boolean; version?: string } | null> {
    try {
      const res = await fetch('https://api.github.com/repos/sameer786ss/OrchCode/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) return null
      const data = await res.json()
      const version: string = data.tag_name?.replace(/^v/, '') ?? ''
      const APP_VERSION = '0.0.0' // overridden at build time via __APP_VERSION__
      return { hasUpdate: !!version && version !== APP_VERSION, version }
    } catch {
      return null
    }
  }
}

expose(workerAPI)

export type BackgroundWorkerAPI = typeof workerAPI
