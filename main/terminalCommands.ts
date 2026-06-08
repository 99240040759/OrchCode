import crypto from 'node:crypto'
import pty from 'node-pty'
import log from 'electron-log'
import { z } from 'zod'
import { getWorkspaceContext, assertWithinWorkspace } from './workspace'

const activePtys = new Map<string, ReturnType<typeof pty.spawn>>()
const activePtyOwners = new Map<string, number>()
const activePtyConversations = new Map<string, string>()
const destroyListeners = new Map<string, () => void>()

export function cleanupAllPtys() {
  activePtys.forEach(p => { try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT'); else p.kill() } catch { try { p.kill() } catch {} } })
  activePtys.clear(); activePtyOwners.clear(); activePtyConversations.clear(); destroyListeners.clear()
}

export function cleanupPtysForThread(threadId: string) {
  activePtyConversations.forEach((convId, id) => {
    if (convId === threadId) {
      const p = activePtys.get(id)
      if (p) {
        try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT'); else p.kill() } catch { try { p.kill() } catch {} }
        activePtys.delete(id); activePtyOwners.delete(id)
      }
      activePtyConversations.delete(id)
    }
  })
}

export const terminalCommands = {
  'terminal:create': {
    schema: z.object({ cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200), cwd: z.string().optional(), conversationId: z.string().optional() }),
    execute: (opts: any, event: any) => {
      const id = `pty-${crypto.randomUUID()}`, shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
      const convCtx = opts.conversationId ? getWorkspaceContext(opts.conversationId) : undefined
      const workingDir = convCtx ? (opts.cwd ? assertWithinWorkspace(convCtx.rootPath, opts.cwd, opts.conversationId!) : convCtx.rootPath) : process.env.HOME || process.cwd()
      let ptyProcess: any
      try {
        ptyProcess = pty.spawn(shell, [], { name: 'xterm-256color', cols: Math.max(opts.cols, 10), rows: Math.max(opts.rows, 3), cwd: workingDir, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
      } catch (err: any) { log.error('[terminal:create] Failed to spawn:', err); throw new Error(`Spawn failed: ${err.message}`) }
      activePtys.set(id, ptyProcess); activePtyOwners.set(id, event.sender.id)
      if (opts.conversationId) activePtyConversations.set(id, opts.conversationId)
      let dataListener: any
      const destroyListener = () => {
        try { if (dataListener) dataListener.dispose(); if (process.platform !== 'win32') process.kill(-ptyProcess.pid, 'SIGINT'); else ptyProcess.kill() } catch { try { ptyProcess.kill() } catch {} }
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id)
      }
      destroyListeners.set(id, destroyListener)
      event.sender.once('destroyed', destroyListener)
      dataListener = ptyProcess.onData((data: string) => {
        if (event.sender.isDestroyed()) { destroyListener(); event.sender.off('destroyed', destroyListener); return }
        try { event.sender.send('terminal:data', { id, data }) } catch {}
      })
      ptyProcess.onExit(({ exitCode }: any) => {
        event.sender.off('destroyed', destroyListener)
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id); destroyListeners.delete(id)
        try { event.sender.send('terminal:exit', { id, exitCode }) } catch {}
      })
      return { id }
    }
  },
  'terminal:input': {
    schema: z.object({ id: z.string().min(1), data: z.string().max(65536) }),
    execute: ({ id, data }: any, event: any) => { if (activePtyOwners.get(id) === event.sender.id) activePtys.get(id)?.write(data) }
  },
  'terminal:resize': {
    schema: z.object({ id: z.string().min(1), cols: z.number().int().min(10).max(500), rows: z.number().int().min(3).max(200) }),
    execute: ({ id, cols, rows }: any, event: any) => { if (activePtyOwners.get(id) === event.sender.id) activePtys.get(id)?.resize(Math.max(cols, 10), Math.max(rows, 3)) }
  },
  'terminal:close': {
    schema: z.object({ id: z.string().min(1) }),
    execute: ({ id }: any, event: any) => {
      if (activePtyOwners.get(id) !== event.sender.id) return
      const listener = destroyListeners.get(id)
      if (listener) { event.sender.off('destroyed', listener); destroyListeners.delete(id) }
      const p = activePtys.get(id)
      if (p) {
        try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGINT'); else p.kill() } catch { try { p.kill() } catch {} }
        activePtys.delete(id); activePtyOwners.delete(id); activePtyConversations.delete(id)
      }
    }
  }
}
