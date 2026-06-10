import log from 'electron-log'
import crypto from 'node:crypto'
import { getDatabasePath } from './utils'
import { EventEmitter } from 'node:events'
export const dbEvents = new EventEmitter()

export interface ThreadEntry { id: string; title?: string; resourceId: string; createdAt: string; updatedAt: string; lifetimeTokens?: number }
export interface ThreadMessage { id: string; role: 'user' | 'assistant' | 'system'; content: string; data?: string; createdAt: string }

const pendingQueries = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>()
let dbPort: any = null
export function setDBPort(port: any) {
  if (dbPort) { try { dbPort.close() } catch {} }
  dbPort = port
  dbPort.on('message', (e: any) => {
    const { id, result, error } = e.data, pending = pendingQueries.get(id)
    if (pending) {
      pendingQueries.delete(id)
      if (error) pending.reject(new Error(error))
      else pending.resolve(result)
    }
  })
  dbPort.start()
}
let worker: any = null
let respawnAttempts = 0
let lifetimeRespawnAttempts = 0
let respawnTimer: NodeJS.Timeout | null = null
const MAX_RESPAWN_ATTEMPTS = 5
const MAX_LIFETIME_RESPAWN_ATTEMPTS = 10
const RESPAWN_BACKOFF_BASE_MS = 500

function spawnWorker() {
  if (lifetimeRespawnAttempts >= MAX_LIFETIME_RESPAWN_ATTEMPTS) {
    log.error('[db] Worker exceeded lifetime respawn limit. Database may be corrupt.')
    const { dialog, app } = require('electron')
    dialog.showErrorBox('Database Error', 'The database has crashed too many times. Please restart the application. If the problem persists, the database file may be corrupted.')
    app.quit()
    return
  }
  const { utilityProcess, app } = require('electron')
  const { join } = require('node:path')
  const { existsSync } = require('node:fs')
  let workerPath = join(__dirname, 'dbWorker.js')
  if (!existsSync(workerPath)) workerPath = join(__dirname, '..', 'dbWorker.js')
  worker = utilityProcess.fork(workerPath, [], { stdio: 'inherit', env: { ...process.env, USER_DATA_PATH: app.getPath('userData'), RESOURCES_PATH: process.resourcesPath } })
  lifetimeRespawnAttempts++
  dbEvents.emit('restarted')
  worker.on('message', (e: any) => {
    const { id, result, error } = e
    const pending = pendingQueries.get(id)
    if (pending) { pendingQueries.delete(id); if (error) pending.reject(new Error(error)); else pending.resolve(result) }
  })
  worker.once('exit', (code: number) => {
    log.error(`[db] Worker process exited with code ${code}`)
    worker = null
    pendingQueries.forEach(p => p.reject(new Error('DB worker crashed')))
    pendingQueries.clear()
    if (respawnAttempts >= MAX_RESPAWN_ATTEMPTS) { log.error('[db] Worker crashed too many times — giving up respawn.'); return }
    const delay = RESPAWN_BACKOFF_BASE_MS * Math.pow(2, respawnAttempts)
    respawnAttempts++
    log.warn(`[db] Respawn #${respawnAttempts} (lifetime: ${lifetimeRespawnAttempts}) in ${delay}ms`)
    if (respawnTimer) clearTimeout(respawnTimer)
    respawnTimer = setTimeout(() => { respawnTimer = null; spawnWorker() }, delay)
  })
  setTimeout(() => { if (worker) { respawnAttempts = 0; log.info('[db] Worker stable, resetting counter') } }, 10000)
}

function getWorker() {
  if (worker) return worker
  spawnWorker()
  return worker
}
export function shareDBPort(clientPort: any) {
  getWorker().postMessage({ type: 'new-client' }, [clientPort])
}

export function runQuery(method: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pendingQueries.set(id, { resolve, reject })
    if (dbPort) {
      try { dbPort.postMessage({ id, method, args, dbPath: getDatabasePath() }) }
      catch (err) { pendingQueries.delete(id); reject(err) }
    } else {
      try { getWorker().postMessage({ id, method, args, dbPath: getDatabasePath() }) }
      catch (err) { pendingQueries.delete(id); reject(err) }
    }
  })
}

export function checkpointDB(): Promise<void> { return runQuery('checkpointDB') }
export function getThreads(): Promise<(ThreadEntry & { workspacePath?: string | null; accumulatedTokens?: number; lifetimeTokens?: number })[]> { return runQuery('getThreads') }
export function getThread(threadId: string): Promise<(ThreadEntry & { workspacePath?: string | null; accumulatedTokens?: number; lifetimeTokens?: number }) | null> { return runQuery('getThread', threadId) }
export function getThreadMessages(threadId: string): Promise<ThreadMessage[]> { return runQuery('getThreadMessages', threadId) }
export function saveMessage(threadId: string, message: Omit<ThreadMessage, 'createdAt'> & { createdAt?: string }): Promise<ThreadMessage> { return runQuery('saveMessage', threadId, message) }
export function deleteThread(threadId: string): Promise<boolean> { return runQuery('deleteThread', threadId) }
export function updateThreadTitle(threadId: string, title: string): Promise<boolean> { return runQuery('updateThreadTitle', threadId, title) }
export function updateThreadAccumulatedTokens(threadId: string, tokens: number): Promise<void> { return runQuery('updateThreadAccumulatedTokens', threadId, tokens) }
export function setThreadAccumulatedTokens(threadId: string, tokens: number): Promise<void> { return runQuery('setThreadAccumulatedTokens', threadId, tokens) }
export function setThreadWorkspace(threadId: string, workspacePath: string): Promise<void> { return runQuery('setThreadWorkspace', threadId, workspacePath) }
export function getThreadWorkspace(threadId: string): Promise<string | null> { return runQuery('getThreadWorkspace', threadId) }
export function addOpenedWorkspace(path: string): Promise<void> { return runQuery('addOpenedWorkspace', path) }
export function bindWorkspaceTransaction(threadId: string, workspacePath: string): Promise<void> { return runQuery('bindWorkspaceTransaction', threadId, workspacePath) }
export function deleteOpenedWorkspace(path: string): Promise<void> { return runQuery('deleteOpenedWorkspace', path) }
export function deleteWorkspaceThreads(workspacePath: string): Promise<string[]> { return runQuery('deleteWorkspaceThreads', workspacePath) }
export function compactThreadHistory(threadId: string, summary: string, keepCount = 10): Promise<void> { return runQuery('compactThreadHistory', threadId, summary, keepCount) }
export function getActiveThreadId(): Promise<string | null> { return runQuery('getActiveThreadId') }
export function setActiveThreadId(threadId: string | null): Promise<void> { return runQuery('setActiveThreadId', threadId) }
export function createThread(threadId: string, workspacePath?: string | null): Promise<void> { return runQuery('createThread', threadId, workspacePath) }
