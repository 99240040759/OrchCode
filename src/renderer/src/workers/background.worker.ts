import * as Comlink from 'comlink'
import { getEncoding } from 'js-tiktoken'

export interface WorkerUpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'error'
  version?: string
  error?: string
}

let _enc: any = null
try {
  _enc = getEncoding('cl100k_base')
} catch (err) {
  console.error('[background-worker] Tiktoken load failed inside worker', err)
}

function isVersionGreater(latest: string, current: string): boolean {
  const cleanLatest = latest.replace(/^v/, '')
  const cleanCurrent = current.replace(/^v/, '')
  const latestParts = cleanLatest.split('.').map(Number)
  const currentParts = cleanCurrent.split('.').map(Number)
  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0
    const c = currentParts[i] || 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

let cachedClientId = 'anonymous-user'

const backgroundWorker = {
  init(clientId: string) {
    if (clientId) {
      cachedClientId = clientId
    }
  },

  async sendTelemetryEvent(eventName: string, params: Record<string, string> = {}) {
    const tid = (typeof process !== 'undefined' && process.env && process.env.GA4_MEASUREMENT_ID) 
      ? process.env.GA4_MEASUREMENT_ID 
      : 'G-JSW00QYW8X'
    const queryParams = new URLSearchParams({
      v: '2',
      tid: tid,
      cid: cachedClientId,
      en: eventName
    })

    Object.entries(params).forEach(([key, value]) => {
      queryParams.append(`ep.${key}`, value)
    })

    const collectUrl = `https://www.google-analytics.com/g/collect?${queryParams.toString()}`

    try {
      await fetch(collectUrl, { method: 'GET', mode: 'no-cors' })
    } catch (err) {
      console.error('[background-worker] Telemetry event log failed:', err)
    }
  },

  estimateTokens(text: string): number {
    if (!text) return 0
    if (!_enc) return Math.ceil(text.length / 4)
    try {
      return _enc.encode(text).length
    } catch {
      return Math.ceil(text.length / 4)
    }
  },

  async checkMacUpdate(currentVersion: string): Promise<WorkerUpdateStatus> {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/sameer786ss/OrchCode/main/latest.yml?t=${Date.now()}`)
      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`)
      }
      const body = await response.text()
      const match = body.match(/version:\s*([^\s]+)/)
      const latestVersion = match ? match[1].trim() : null
      if (!latestVersion) {
        throw new Error('Version tag not found in latest.yml')
      }

      if (isVersionGreater(latestVersion, currentVersion)) {
        return { status: 'available', version: latestVersion }
      } else {
        return { status: 'idle', version: latestVersion }
      }
    } catch (err: any) {
      return { status: 'error', error: err.message }
    }
  }
}

Comlink.expose(backgroundWorker)

export type BackgroundWorkerType = typeof backgroundWorker
