import { atom } from 'jotai'
import type { ThreadEntry, ArtifactEntry, UpdateStatus, UserProfile } from '../../../preload/index.d'

export const conversationIdAtom = atom<string>('')

export const threadListAtom = atom<ThreadEntry[]>([])
export const activeThreadIdAtom = atom<string | null>(null)

export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom)
  const activeId = get(activeThreadIdAtom)
  return threads.find((t) => t.id === activeId)
})

type AgentRunState = 'idle' | 'thinking' | 'streaming' | 'tool-calling' | 'error'
export const agentRunStateAtom = atom<AgentRunState>('idle')

export type StreamBlock =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string; durationMs?: number; isStreaming?: boolean }
  | { type: 'tool'; toolCallId: string; toolName: string; args: Record<string, unknown>; result?: unknown; status: 'pending' | 'complete' | 'error' }
  | { type: 'compaction' }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: string
  orderedBlocks?: StreamBlock[]
  timestamp: number
  isStreaming?: boolean
}

export interface ToolCallEntry {
  id: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'complete' | 'error'
}

export const chatMessagesAtom = atom<ChatMessage[]>([])

export const artifactsAtom = atom<ArtifactEntry[]>([])

export interface FileChangeEntry {
  path: string
  name: string
  toolName: string
  additions: number
  deletions: number
  lineRange: string
  timestamp: number
}
export const filesChangedAtom = atom<FileChangeEntry[]>([])

export const sessionTokensAtom = atom<number>(0)

export const sidebarExpandedAtom = atom<boolean>(true)

export const activeWorkspaceAtom = atom<{ name: string; path: string } | null>(null)

export const isArtifactPanelOpenAtom = atom<boolean>(false)
export type ArtifactPanelMode = 'editor' | 'terminal' | 'browser' | 'overview'
export const artifactPanelModeAtom = atom<ArtifactPanelMode>('overview')
export const openFilesAtom = atom<EditorFile[]>([])

export interface EditorFile {
  name: string
  path: string
  content?: string
  language?: string
  isBinary?: boolean
  mimeType?: string
  base64?: string
}
export const activeEditorFileAtom = atom<EditorFile | null>(null)

export const hasMessagesAtom = atom<boolean>((get) => get(chatMessagesAtom).length > 0)

export const globalPromptTriggerAtom = atom<{ prompt: string; mode?: string } | null>(null)

export const availableModelsAtom = atom<{ gemini?: { id: string; name: string }; gemma?: { id: string; name: string } }>({})
export const selectedModelAtom = atom<'gemini' | 'gemma'>('gemini')

export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })

export const authUserAtom = atom<UserProfile | null>(null)
