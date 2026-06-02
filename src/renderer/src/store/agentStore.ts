import { atom } from 'jotai'
import type {
  ThreadEntry,
  ArtifactEntry,
  UpdateStatus,
  UserProfile
} from '../../../preload/index.d'

export type {
  AgentRunState,
  StreamBlock,
  ChatMessage,
  ToolCallEntry,
  FileChangeEntry,
  ArtifactPanelMode,
  EditorFile,
  ModelInfo
} from './types'

export const conversationIdAtom = atom<string>('')

export const threadListAtom = atom<ThreadEntry[]>([])
export const activeThreadIdAtom = atom<string | null>(null)

export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom)
  const activeId = get(activeThreadIdAtom)
  return threads.find((t) => t.id === activeId)
})

export const agentRunStateAtom = atom<import('./types').AgentRunState>('idle')

export const chatMessagesAtom = atom<import('./types').ChatMessage[]>([])

export const artifactsAtom = atom<ArtifactEntry[]>([])

export const filesChangedAtom = atom<import('./types').FileChangeEntry[]>([])

export const sessionTokensAtom = atom<number>(0)

export const sidebarExpandedAtom = atom<boolean>(true)

export const activeWorkspaceAtom = atom<{ name: string; path: string } | null>(null)

export const isArtifactPanelOpenAtom = atom<boolean>(false)
export const artifactPanelModeAtom = atom<import('./types').ArtifactPanelMode>('overview')
export const openFilesAtom = atom<import('./types').EditorFile[]>([])

export const activeEditorFileAtom = atom<import('./types').EditorFile | null>(null)

export const hasMessagesAtom = atom<boolean>((get) => get(chatMessagesAtom).length > 0)

export const globalPromptTriggerAtom = atom<{ prompt: string; mode?: string } | null>(null)

export const availableModelsAtom = atom<Record<string, import('./types').ModelInfo>>({})
export const selectedModelAtom = atom<string>('')

export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })

export const authUserAtom = atom<UserProfile | null>(null)
