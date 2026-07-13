import { resolve as pathResolve, relative as pathRelative, isAbsolute } from 'path'
import { writeFile, rename, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'

export function isPathAllowedPure(
  filePath: string,
  userDataDir: string,
  allowedFolders: string[]
): boolean {
  try {
    const resolved = pathResolve(filePath)
    const relToUserData = pathRelative(userDataDir, resolved)
    if (!relToUserData.startsWith('..') && !isAbsolute(relToUserData)) return true
    return allowedFolders.some((f) => {
      const folderResolved = pathResolve(f)
      const rel = pathRelative(folderResolved, resolved)
      return !rel.startsWith('..') && !isAbsolute(rel)
    })
  } catch {
    return false
  }
}

export async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, contents, 'utf-8')
  for (let i = 0; i <= 3; i++) {
    try {
      await rename(temporaryPath, filePath)
      return
    } catch (renameErr: unknown) {
      const code = (renameErr as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'EPERM') {
        try {
          await unlink(filePath)
        } catch {
          /* best-effort */
        }
        if (i < 3) {
          await new Promise((r) => setTimeout(r, 50 * Math.pow(2, i)))
          continue
        }
      }
      try {
        await unlink(temporaryPath)
      } catch {
        /* best-effort */
      }
      throw renameErr
    }
  }
}
export function serviceUrl(path: string): string | undefined {
  const base = process.env.GCP_FUNCTIONS_URL?.trim().replace(/\/+$/, '')
  if (!base) return undefined
  try {
    new URL(base)
    return `${base}/${path.replace(/^\/+/, '')}`
  } catch {
    return undefined
  }
}
