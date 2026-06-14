import crypto from 'node:crypto'
import { getMemories, saveMemory as dbSaveMemory, updateMemory as dbUpdateMemory, deleteMemory as dbDeleteMemory } from './db'

export interface MemoryEntry {
  id: string
  content: string
  category: string
  workspace_path: string | null
  created_at: string
  updated_at: string
}

export async function saveMemory(content: string, category: string, workspacePath?: string | null): Promise<string> {
  const id = crypto.randomUUID()
  await dbSaveMemory(id, content, category, workspacePath)
  return id
}

export async function getRelevantMemories(workspacePath?: string | null): Promise<MemoryEntry[]> {
  return await getMemories(workspacePath) as MemoryEntry[]
}

export async function updateMemory(id: string, content: string, category?: string): Promise<void> {
  await dbUpdateMemory(id, content, category)
}

export async function deleteMemoryById(id: string): Promise<void> {
  await dbDeleteMemory(id)
}

export async function buildMemoryContext(workspacePath?: string | null): Promise<string> {
  const memories = await getRelevantMemories(workspacePath)
  if (memories.length === 0) return ''
  const grouped: Record<string, string[]> = {}
  for (const m of memories) {
    const cat = m.category || 'general'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(m.content)
  }
  let section = '\n\n## Memories\nYou have the following saved memories from previous conversations. Use them to inform your responses:\n'
  for (const [cat, items] of Object.entries(grouped)) {
    section += `\n### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n`
    for (const item of items) section += `- ${item}\n`
  }
  return section
}

export async function getMemoryStats(): Promise<{total: number; byCategory: Record<string, number>}> {
  const all = await getMemories()
  const byCategory: Record<string, number> = {}
  for (const m of all) {
    const cat = (m as MemoryEntry).category || 'general'
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }
  return { total: all.length, byCategory }
}
