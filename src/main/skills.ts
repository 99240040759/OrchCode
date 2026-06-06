import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs, existsSync } from 'node:fs'
import log from 'electron-log'

export function getSkillsPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'skills')
  }
  return join(app.getAppPath(), 'resources', 'skills')
}

export function getUserSkillsPath(): string {
  return join(app.getPath('userData'), 'skills')
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath)
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

/**
 * Scans the installed skills directory and returns metadata for each skill:
 * the folder name and the first-line description from its SKILL.md (if any).
 */
export async function listInstalledSkills(): Promise<{ name: string; description: string }[]> {
  const skillsDir = getUserSkillsPath()
  if (!existsSync(skillsDir)) return []
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    const skills = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          let description = ''
          try {
            const skillMd = join(skillsDir, e.name, 'SKILL.md')
            const content = await fs.readFile(skillMd, 'utf-8')
            // Extract the first non-empty, non-heading line as a one-line description
            const lines = content.split('\n')
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed && !trimmed.startsWith('#')) {
                description = trimmed.slice(0, 120)
                break
              }
            }
          } catch {
            // No SKILL.md — just use the folder name
          }
          return { name: e.name, description }
        })
    )
    return skills
  } catch (err) {
    log.warn('[skills] Failed to list installed skills:', err)
    return []
  }
}

export async function initializeSkills(): Promise<void> {
  try {
    const srcSkillsDir = getSkillsPath()
    const destSkillsDir = getUserSkillsPath()

    log.info(`[main] Initializing skills: src=${srcSkillsDir} dest=${destSkillsDir}`)

    if (!existsSync(srcSkillsDir)) {
      log.warn(`[main] Source skills directory does not exist: ${srcSkillsDir}`)
      return
    }

    await fs.mkdir(destSkillsDir, { recursive: true })

    const skillFolders = await fs.readdir(srcSkillsDir, { withFileTypes: true })
    for (const folder of skillFolders) {
      if (folder.isDirectory()) {
        const src = join(srcSkillsDir, folder.name)
        const dest = join(destSkillsDir, folder.name)
        await copyDirRecursive(src, dest)
      }
    }

    log.info('[main] Skills initialized successfully.')
  } catch (err) {
    log.error('[main] Failed to initialize skills:', err)
  }
}
