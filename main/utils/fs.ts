import { resolve as pathResolve, relative as pathRelative, isAbsolute } from 'path'
import { writeFile, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
export function isPathAllowedPure(filePath: string, userDataDir: string | undefined, allowedFolders: string[]): boolean {
  try {
    let resolved = pathResolve(filePath)
    let folders = allowedFolders
    if (process.platform === 'win32') {
      resolved = resolved.toLowerCase()
      folders = folders.map(f => pathResolve(f).toLowerCase())
    }
    if (userDataDir) {
      const userDir = process.platform === 'win32' ? userDataDir.toLowerCase() : userDataDir
      const relToUserData = pathRelative(userDir, resolved)
      if (!relToUserData.startsWith('..') && !isAbsolute(relToUserData)) return true
    }
    return folders.some((f) => {
      const rel = pathRelative(f, resolved)
      return !rel.startsWith('..') && !isAbsolute(rel)
    })
  } catch { return false }
}
export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, contents, 'utf-8')
  for (let i = 0; i < 3; i++) {
    try {
      await rename(temporaryPath, filePath)
      return
    } catch (renameErr: unknown) {
      const code = (renameErr as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY') {
        await new Promise((r) => setTimeout(r, 50 * Math.pow(2, i)))
        continue
      }
      try { await unlink(temporaryPath) } catch {}
      throw renameErr
    }
  }
  try { await unlink(temporaryPath) } catch {}
  throw new Error(`Failed to atomically write ${filePath} after 3 attempts.`)
}
export function serviceUrl(path: string): string | undefined {
  const base = process.env.GCP_FUNCTIONS_URL?.trim().replace(/\/+$/, '')
  if (!base) return undefined
  try {
    const parsed = new URL(base)
    if (parsed.protocol !== 'https:') return undefined
    return `${base}/${path.replace(/^\/+/, '')}`
  } catch { return undefined }
}
