import { join } from 'node:path'
import { promises as fs, existsSync } from 'node:fs'
import log from 'electron-log'
function getAppInfo() {
  if (process.env.USER_DATA_PATH) return { isPackaged: process.env.IS_PACKAGED === 'true', resourcesPath: process.env.RESOURCES_PATH || '', appPath: process.env.APP_PATH || '', userData: process.env.USER_DATA_PATH }
  const { app } = require('electron')
  return { isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), userData: app.getPath('userData') }
}
export function getSkillsPath(): string {
  const info = getAppInfo()
  return info.isPackaged ? join(info.resourcesPath, 'resources', 'skills') : join(info.appPath, 'resources', 'skills')
}
export function getUserSkillsPath(): string { return join(getAppInfo().userData, 'skills') }


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
    log.error('[skills] Failed to list installed skills:', err)
    throw err
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
        if (!existsSync(dest)) await fs.cp(src, dest, { recursive: true })
      }
    }

    log.info('[main] Skills initialized successfully.')
  } catch (err) {
    log.error('[main] Failed to initialize skills:', err)
    throw err
  }
}
