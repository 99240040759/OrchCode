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

async function copyDirAndConvertPaths(
  srcDir: string,
  destDir: string,
  rootDestSkillDir: string,
  childrenNames: string[]
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })
  const entries = await fs.readdir(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copyDirAndConvertPaths(srcPath, destPath, rootDestSkillDir, childrenNames)
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.md')) {
        let content = await fs.readFile(srcPath, 'utf-8')

        // Replace relative child references with absolute paths
        for (const childName of childrenNames) {
          // 1. Folder references (e.g. scripts/office/unpack.py)
          const folderRegex = new RegExp(`\\b${childName}[/\\\\]([a-zA-Z0-9_\\-/.]+)`, 'g')
          content = content.replace(folderRegex, (_, subpath) => {
            const absolutePath = join(rootDestSkillDir, childName, subpath).replace(/\\/g, '/')
            return `"${absolutePath}"`
          })

          // 2. Direct file references (e.g. theme-showcase.pdf, forms.md, or themes)
          // Avoid matching when it's already part of an absolute path (wrapped in quotes)
          const fileRegex = new RegExp(`\\b${childName.replace('.', '\\.')}(?!\\/|\\\\|\\w)\\b`, 'gi')
          content = content.replace(fileRegex, () => {
            const absolutePath = join(rootDestSkillDir, childName).replace(/\\/g, '/')
            return `"${absolutePath}"`
          })
        }

        await fs.writeFile(destPath, content, 'utf-8')
      } else {
        await fs.copyFile(srcPath, destPath)
      }
    }
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

    // Ensure destination skills folder exists
    await fs.mkdir(destSkillsDir, { recursive: true })

    const skillFolders = await fs.readdir(srcSkillsDir, { withFileTypes: true })
    for (const folder of skillFolders) {
      if (folder.isDirectory()) {
        const srcSkillDir = join(srcSkillsDir, folder.name)
        const destSkillDir = join(destSkillsDir, folder.name)

        // Find all top-level children in this skill to use for replacement
        const children = await fs.readdir(srcSkillDir)
        // Filter out the main SKILL.md and LICENSE.txt or other .md files from children replacement list
        const replacementChildren = children.filter((c) => c !== 'SKILL.md' && c !== 'LICENSE.txt')

        await copyDirAndConvertPaths(srcSkillDir, destSkillDir, destSkillDir, replacementChildren)
      }
    }

    log.info('[main] Skills initialized and paths converted successfully.')
  } catch (err) {
    log.error('[main] Failed to initialize skills:', err)
  }
}
