import { atom } from 'jotai'
import { splitAtom } from 'jotai/utils'
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

/**
 * Single source of truth for the active thread/conversation ID.
 * Previously there were two separate atoms (conversationIdAtom + activeThreadIdAtom)
 * kept in sync manually. Now unified into one atom.
 * conversationIdAtom is kept as an alias for backward compatibility.
 */
export const activeThreadIdAtom = atom<string>('')
// Alias — both refer to the same atom
export const conversationIdAtom = activeThreadIdAtom

export const threadListAtom = atom<ThreadEntry[]>([])

export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom)
  const activeId = get(activeThreadIdAtom)
  return threads.find((t) => t.id === activeId)
})

/** True while thread messages/workspace are being loaded (thread switch in progress) */
export const isThreadLoadingAtom = atom<boolean>(false)

export const agentRunStateAtom = atom<import('./types').AgentRunState>('idle')

export const chatMessagesAtom = atom<import('./types').ChatMessage[]>([])

export const chatMessageAtomsAtom = splitAtom(chatMessagesAtom)

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

export const globalPromptTriggerAtom = atom<{ prompt: string; mode?: string; threadId?: string } | null>(null)

export const availableModelsAtom = atom<Record<string, import('./types').ModelInfo>>({})
export const selectedModelAtom = atom<string>('')

export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })

export const authUserAtom = atom<UserProfile | null>(null)
