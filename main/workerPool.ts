import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log'

export class WorkerPool {
  private workers: UtilityProcess[] = []
  private activeJobs = new Map<number, string>()
  constructor(private maxWorkers = 4) {}

  public getOrCreateWorker(token?: string): UtilityProcess {
    const idle = this.workers.find(w => !this.activeJobs.has(w.pid!))
    if (idle) {
      if (token) idle.postMessage({ type: 'update-token', token })
      return idle
    }
    if (this.workers.length < this.maxWorkers) {
      let workerPath = join(__dirname, 'agentWorker.js')
      if (!existsSync(workerPath)) workerPath = join(__dirname, '..', 'agentWorker.js')
      log.info(`[workerPool] Spawning utilityProcess worker at: ${workerPath}`)
      const { app } = require('electron')
      const child = utilityProcess.fork(workerPath, [], {
        stdio: 'inherit',
        env: { ...process.env, SUPABASE_SESSION_TOKEN: token || '', USER_DATA_PATH: app.getPath('userData'), RESOURCES_PATH: process.resourcesPath, APP_PATH: app.getAppPath(), IS_PACKAGED: app.isPackaged ? 'true' : 'false' }
      })
      child.on('exit', (code) => {
        log.info(`[workerPool] Worker pid ${child.pid} exited with code ${code}`)
        this.workers = this.workers.filter(w => w.pid !== child.pid)
        this.activeJobs.delete(child.pid!)
      })
      this.workers.push(child)
      return child
    }
    const selected = this.workers[Math.floor(Math.random() * this.workers.length)]
    if (token) selected.postMessage({ type: 'update-token', token })
    return selected
  }
  public setJob(pid: number, jobName: string) { this.activeJobs.set(pid, jobName) }
  public clearJob(pid: number) { this.activeJobs.delete(pid) }
  public allocateWorker(token: string, jobName: string): UtilityProcess {
    const worker = this.getOrCreateWorker(token)
    this.setJob(worker.pid!, jobName)
    return worker
  }
  public async shutdown(): Promise<void> {
    for (const w of this.workers) { try { w.kill() } catch {} }
    this.workers = []; this.activeJobs.clear()
  }
}
export const pool = new WorkerPool()
