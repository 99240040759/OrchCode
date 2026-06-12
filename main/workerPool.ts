import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import log from 'electron-log'
import { dbEvents } from './db'

const IDLE_KILL_MS = 60_000

interface QueueEntry { resolve: (w: UtilityProcess) => void; reject: (err: Error) => void; token: string; jobName: string }

class WorkerPool {
  private workers: UtilityProcess[] = []
  private activeJobs = new Map<UtilityProcess, string>()
  private idleTimers = new Map<UtilityProcess, NodeJS.Timeout>()
  private waitQueue: QueueEntry[] = []
  private readonly minWorkers = 1

  constructor(private maxWorkers = 4) {
    dbEvents.on('restarted', () => this.reShareDBPorts())
  }

  public reShareDBPorts() {
    const { MessageChannelMain } = require('electron')
    const { shareDBPort } = require('./db')
    log.info(`[workerPool] DB worker restarted. Re-sharing DB ports with ${this.workers.length} workers.`)
    for (const w of this.workers) {
      if (this.activeJobs.has(w)) { log.debug(`[workerPool] Skipping DB port reshare for busy worker pid ${w.pid}`); continue }
      try {
        const { port1, port2 } = new MessageChannelMain()
        shareDBPort(port1)
        w.postMessage({ type: 'db-port' }, [port2])
      } catch (err) { log.debug('[workerPool] Port sharing error:', err) }
    }
  }

  private resolveWorkerPath(): string {
    let p = join(__dirname, 'agentWorker.js')
    if (!existsSync(p)) p = join(__dirname, '..', 'agentWorker.js')
    return p
  }

  private spawnWorker(token?: string): UtilityProcess {
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

  /** Get an idle worker or spawn one up to maxWorkers. Throws only if called internally when queue logic is already satisfied. */
  private getIdleOrSpawn(token?: string): UtilityProcess {
    const idle = this.workers.find(w => !this.activeJobs.has(w))
    if (idle) {
      const timer = this.idleTimers.get(idle)
      if (timer) { clearTimeout(timer); this.idleTimers.delete(idle) }
      if (token) idle.postMessage({ type: 'update-token', token })
      return idle
    }
    return this.spawnWorker(token)
  }

  public setJob(worker: UtilityProcess, jobName: string) { this.activeJobs.set(worker, jobName) }

  public clearJob(worker: UtilityProcess) {
    this.activeJobs.delete(worker)
    // Drain queue — give this freed worker to the next waiting caller immediately.
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!
      log.info(`[workerPool] Draining queue — assigning worker pid ${worker.pid} to job "${next.jobName}"`)
      if (next.token) worker.postMessage({ type: 'update-token', token: next.token })
      this.setJob(worker, next.jobName)
      next.resolve(worker)
      return // skip idle timer — worker immediately goes to next job
    }
    // Schedule idle kill if above min worker count
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

  /** Returns true if any active job name matches the given jobName. */
  public hasActiveJob(jobName: string): boolean {
    for (const name of this.activeJobs.values()) { if (name === jobName) return true }
    return false
  }

  /**
   * Async allocation — returns a worker immediately if a slot is available (idle worker or pool
   * not yet at capacity), otherwise queues the request and resolves when a slot opens.
   * Never throws on capacity — callers wait gracefully.
   */
  public allocateWorker(token: string, jobName: string): Promise<UtilityProcess> {
    const hasIdle = this.workers.some(w => !this.activeJobs.has(w))
    const canSpawn = this.workers.length < this.maxWorkers
    if (hasIdle || canSpawn) {
      const w = this.getIdleOrSpawn(token)
      this.setJob(w, jobName)
      return Promise.resolve(w)
    }
    log.info(`[workerPool] Pool at capacity (${this.maxWorkers}), queuing job "${jobName}"`)
    return new Promise<UtilityProcess>((resolve, reject) => { this.waitQueue.push({ resolve, reject, token, jobName }) })
  }

  public killJob(jobName: string) {
    const toKill: UtilityProcess[] = []
    this.activeJobs.forEach((name, w) => { if (name === jobName) toKill.push(w) })
    for (const w of toKill) {
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

  public preWarm() {
    const toSpawn = this.minWorkers - this.workers.length
    for (let i = 0; i < toSpawn; i++) this.spawnWorker()
    log.info(`[workerPool] Pre-warmed ${toSpawn} worker(s). Pool size: ${this.workers.length}`)
  }

  public async shutdown(): Promise<void> {
    for (const [, timer] of this.idleTimers) clearTimeout(timer)
    this.idleTimers.clear()
    for (const entry of this.waitQueue) entry.reject(new Error('Worker pool shutting down'))
    this.waitQueue.length = 0
    for (const w of this.workers) { try { w.kill() } catch (err) { log.debug('[workerPool] Failed to kill worker on shutdown:', err) } }
    this.workers = []
    this.activeJobs.clear()
  }
}

export const pool = new WorkerPool()
