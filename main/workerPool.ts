import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log'
import { dbEvents } from './db'

const IDLE_KILL_MS = 60_000

class WorkerPool {
  private workers: UtilityProcess[] = []
  private activeJobs = new Map<UtilityProcess, string>()
  private idleTimers = new Map<UtilityProcess, NodeJS.Timeout>()
  private readonly minWorkers = 1
  constructor(private maxWorkers = 4) {
    dbEvents.on('restarted', () => this.reShareDBPorts())
  }

  public reShareDBPorts() {
    const { MessageChannelMain } = require('electron')
    const { shareDBPort } = require('./db')
    log.info(`[workerPool] DB worker restarted. Re-sharing DB ports with ${this.workers.length} workers.`)
    for (const w of this.workers) {
      try {
        const { port1, port2 } = new MessageChannelMain()
        shareDBPort(port1)
        w.postMessage({ type: 'db-port' }, [port2])
      } catch (err) { log.debug('[workerPool] Port sharing error:', err) }
    }
  }

  private resolveWorkerPath(): string {
    let workerPath = join(__dirname, 'agentWorker.js')
    if (!existsSync(workerPath)) workerPath = join(__dirname, '..', 'agentWorker.js')
    return workerPath
  }

  public getOrCreateWorker(token?: string): UtilityProcess {
    const idle = this.workers.find(w => !this.activeJobs.has(w))
    if (idle) {
      const timer = this.idleTimers.get(idle)
      if (timer) { clearTimeout(timer); this.idleTimers.delete(idle) }
      if (token) idle.postMessage({ type: 'update-token', token })
      return idle
    }
    if (this.workers.length >= this.maxWorkers) {
      throw new Error(`Worker pool at capacity (${this.maxWorkers}). Try again shortly.`)
    }
    const workerPath = this.resolveWorkerPath()
    const { app } = require('electron')
    log.info(`[workerPool] Spawning worker at: ${workerPath} (Pool size: ${this.workers.length + 1})`)
    const child = utilityProcess.fork(workerPath, [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        SUPABASE_SESSION_TOKEN: token || '',
        USER_DATA_PATH: app.getPath('userData'),
        RESOURCES_PATH: process.resourcesPath,
        APP_PATH: app.getAppPath(),
        IS_PACKAGED: app.isPackaged ? 'true' : 'false'
      }
    })
    child.on('exit', (code) => {
      log.info(`[workerPool] Worker pid ${child.pid} exited with code ${code}`)
      const timer = this.idleTimers.get(child)
      if (timer) { clearTimeout(timer); this.idleTimers.delete(child) }
      this.workers = this.workers.filter(w => w !== child)
      this.activeJobs.delete(child)
    })
    this.workers.push(child)
    return child
  }

  public setJob(worker: UtilityProcess, jobName: string) {
    this.activeJobs.set(worker, jobName)
  }

  public clearJob(worker: UtilityProcess) {
    this.activeJobs.delete(worker)
    // Only schedule a kill if above minWorkers; the minimum worker stays warm indefinitely
    if (this.workers.length > this.minWorkers) {
      const timer = setTimeout(() => {
        this.idleTimers.delete(worker)
        if (!this.activeJobs.has(worker)) {
          const idx = this.workers.indexOf(worker)
          if (idx !== -1) {
            log.info(`[workerPool] Idle timeout — terminating worker pid ${worker.pid}`)
            try { worker.kill() } catch (err) { log.debug('[workerPool] Failed to kill idle worker:', err) }
            this.workers.splice(idx, 1)
          }
        }
      }, IDLE_KILL_MS)
      this.idleTimers.set(worker, timer)
    }
  }

  public allocateWorker(token: string, jobName: string): UtilityProcess {
    const worker = this.getOrCreateWorker(token)
    this.setJob(worker, jobName)
    return worker
  }

  public killJob(jobName: string) {
    const workersToKill: UtilityProcess[] = []
    this.activeJobs.forEach((name, w) => { if (name === jobName) workersToKill.push(w) })
    for (const w of workersToKill) {
      const timer = this.idleTimers.get(w)
      if (timer) { clearTimeout(timer); this.idleTimers.delete(w) }
      const idx = this.workers.indexOf(w)
      if (idx !== -1) {
        try { w.kill() } catch (err) { log.debug('[workerPool] Failed to kill worker:', err) }
        this.workers.splice(idx, 1)
      }
      this.activeJobs.delete(w)
    }
  }

  public async shutdown(): Promise<void> {
    for (const [, timer] of this.idleTimers) clearTimeout(timer)
    this.idleTimers.clear()
    for (const w of this.workers) { try { w.kill() } catch (err) { log.debug('[workerPool] Failed to kill worker on shutdown:', err) } }
    this.workers = []
    this.activeJobs.clear()
  }
}

export const pool = new WorkerPool()
