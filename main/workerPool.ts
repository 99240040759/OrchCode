import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log'

class WorkerPool {
  private workers: UtilityProcess[] = []
  private activeJobs = new Map<UtilityProcess, string>()
  constructor(private maxWorkers = 4) {}

  public getOrCreateWorker(token?: string): UtilityProcess {
    const idle = this.workers.find(w => !this.activeJobs.has(w))
    if (idle) {
      if (token) idle.postMessage({ type: 'update-token', token })
      return idle
    }
    let workerPath = join(__dirname, 'agentWorker.js')
    if (!existsSync(workerPath)) workerPath = join(__dirname, '..', 'agentWorker.js')
    log.info(`[workerPool] Spawning utilityProcess worker at: ${workerPath} (Pool size: ${this.workers.length + 1})`)
    const { app } = require('electron')
    const child = utilityProcess.fork(workerPath, [], {
      stdio: 'inherit',
      env: { ...process.env, SUPABASE_SESSION_TOKEN: token || '', USER_DATA_PATH: app.getPath('userData'), RESOURCES_PATH: process.resourcesPath, APP_PATH: app.getAppPath(), IS_PACKAGED: app.isPackaged ? 'true' : 'false' }
    })
    child.on('exit', (code) => {
      log.info(`[workerPool] Worker pid ${child.pid} exited with code ${code}`)
      this.workers = this.workers.filter(w => w !== child)
      this.activeJobs.delete(child)
    })
    this.workers.push(child)
    return child
  }
  public setJob(worker: UtilityProcess, jobName: string) { this.activeJobs.set(worker, jobName) }
  public clearJob(worker: UtilityProcess) {
    this.activeJobs.delete(worker)
    if (this.workers.length > this.maxWorkers) {
      const idx = this.workers.indexOf(worker)
      if (idx !== -1) {
        log.info(`[workerPool] Terminating temporary worker pid ${worker.pid} to scale down pool.`)
        try { worker.kill() } catch {}
        this.workers.splice(idx, 1)
      }
    }
  }
  public allocateWorker(token: string, jobName: string): UtilityProcess {
    const worker = this.getOrCreateWorker(token)
    this.setJob(worker, jobName)
    return worker
  }
  public killJob(jobName: string) {
    const workersToKill: UtilityProcess[] = []
    this.activeJobs.forEach((name, w) => {
      if (name === jobName) workersToKill.push(w)
    })
    for (const w of workersToKill) {
      const idx = this.workers.indexOf(w)
      if (idx !== -1) { try { w.kill() } catch {} ; this.workers.splice(idx, 1) }
      this.activeJobs.delete(w)
    }
  }
  public async shutdown(): Promise<void> {
    for (const w of this.workers) { try { w.kill() } catch {} }
    this.workers = []; this.activeJobs.clear()
  }
}
export const pool = new WorkerPool()
