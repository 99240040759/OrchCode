import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import WindowManager from '../windowManager'
import { getWorkspaceContext } from '../workspace'

export interface ArtifactEntry {
  name: string
  path: string
  size: number
  modified: string
}

export async function pushArtifactsChanged(conversationId: string): Promise<void> {
  const mainWindow = WindowManager.getMainWindow()
  if (!mainWindow) return
  const ctx = getWorkspaceContext(conversationId)
  if (!ctx) return
  try {
    const entries = await fs.readdir(ctx.artifactsPath, { withFileTypes: true })
    const artifacts = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const p = join(ctx.artifactsPath, e.name)
          const stat = await fs.stat(p)
          return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
        })
    )
    mainWindow.webContents.send('artifacts:changed', { conversationId, artifacts })
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function listArtifacts(conversationId: string): Promise<ArtifactEntry[]> {
  const ctx = getWorkspaceContext(conversationId)
  if (!ctx) return []
  try {
    const entries = await fs.readdir(ctx.artifactsPath, { withFileTypes: true })
    return Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const p = join(ctx.artifactsPath, e.name)
          const stat = await fs.stat(p)
          return { name: e.name, path: p, size: stat.size, modified: stat.mtime.toISOString() }
        })
    )
  } catch (err: any) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}
