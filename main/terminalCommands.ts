import crypto from 'node:crypto'
import log from 'electron-log'
import { z } from 'zod'
import { getWorkspaceContext, assertWithinWorkspace } from './workspace'

const activePtys = new Map<string, any>()
const activePtyOwners = new Map<string, number>()
const activePtyConversations = new Map<string, string>()
const destroyListeners = new Map<string, () => void>()

export function cleanupAllPtys() {
  activePtys.forEach(child => { try { child.kill() } catch (err) { log.debug('[terminal] PTY kill error:', err) } })
  activePtys.clear(); activePtyOwners.clear(); activePtyConversations.clear(); destroyListeners.clear()
}

export function cleanupPtysForThread(threadId: string) {
  activePtyConversations.forEach((convId, id) => {
    if (convId === threadId) {
      const child = activePtys.get(id)
      if (child) {
        try { child.kill() } catch (err) { log.debug('[terminal] Thread PTY kill error:', err) }
        activePtys.delete(id); activePtyOwners.delete(id)
      }
      activePtyConversations.delete(id)
    }
  })
}

export const terminalCommands = {
  'terminal:create': {
    schema: z.object({ id: z.string().optional(), cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200), cwd: z.string().optional(), conversationId: z.string().optional() }),
    execute: (opts: any, event: any) => {
      const { utilityProcess, MessageChannelMain, app } = require('electron')
      const { join } = require('node:path')
      const { existsSync } = require('node:fs')

      const id = opts.id || `pty-${crypto.randomUUID()}`, shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
      const convCtx = opts.conversationId ? getWorkspaceContext(opts.conversationId) : undefined
      const workingDir = convCtx ? (opts.cwd ? assertWithinWorkspace(convCtx.rootPath, opts.cwd, opts.conversationId!) : convCtx.rootPath) : process.env.HOME || process.cwd()

      let ptyWorkerPath = join(__dirname, 'ptyWorker.js')
      if (!existsSync(ptyWorkerPath)) ptyWorkerPath = join(__dirname, '..', 'ptyWorker.js')

      const child = utilityProcess.fork(ptyWorkerPath, [], {
        stdio: 'inherit',
        env: { ...process.env, USER_DATA_PATH: app.getPath('userData'), RESOURCES_PATH: process.resourcesPath }
      })

      const { port1, port2 } = new MessageChannelMain()
      event.sender.postMessage(`terminal:port:${id}`, null, [port2])

      child.postMessage({ type: 'init-pty', cols: opts.cols, rows: opts.rows, cwd: workingDir, shell }, [port1])

      activePtys.set(id, child)
      activePtyOwners.set(id, event.sender.id)
      if (opts.conversationId) activePtyConversations.set(id, opts.conversationId)

      const destroyListener = () => {
        try { child.kill() } catch (err) { log.debug('[terminal] Child PTY worker kill error:', err) }
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id)
      }
      destroyListeners.set(id, destroyListener)
      event.sender.once('destroyed', destroyListener)

      child.once('exit', () => {
        event.sender.off('destroyed', destroyListener)
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id)
      })

      return { id }
    }
  },
  'terminal:close': {
    schema: z.object({ id: z.string().min(1) }),
    execute: ({ id }: any, event: any) => {
      if (activePtyOwners.get(id) !== event.sender.id) return
      const listener = destroyListeners.get(id)
      if (listener) { event.sender.off('destroyed', listener); destroyListeners.delete(id) }
      const child = activePtys.get(id)
      if (child) {
        try { child.kill() } catch (err) { log.debug('[terminal] Kill child error:', err) }
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id)
      }
    }
  }
}
