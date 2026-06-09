import { atom } from 'jotai'
import { splitAtom, atomWithStorage } from 'jotai/utils'
import type {
  ThreadEntry,
  ArtifactEntry,
  UpdateStatus,
  UserProfile
} from '../../preload/index.d'

export type { StreamBlock, EditorFile, ChatMessage, ToolCallEntry } from './types'

type AgentRunState = 'idle' | 'thinking' | 'streaming' | 'tool-calling' | 'error'
export type ArtifactPanelMode = 'editor' | 'terminal' | 'browser' | 'overview'
interface ModelInfo {
  id: string
  name: string
}

/**
 * Single source of truth for the active thread/conversation ID.
 * Previously there were two separate atoms (conversationIdAtom + activeThreadIdAtom)
 * kept in sync manually. Now unified into one atom.
 * conversationIdAtom is kept as an alias for backward compatibility.
 */
export const activeThreadIdAtom = atom<string>('')

export const threadListAtom = atom<ThreadEntry[]>([])

export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom)
  const activeId = get(activeThreadIdAtom)
  return threads.find((t) => t.id === activeId)
})

/** True while thread messages/workspace are being loaded (thread switch in progress) */
export const isThreadLoadingAtom = atom<boolean>(false)

export const agentRunStateAtom = atom<AgentRunState>('idle')

export const chatMessagesAtom = atom<import('./types').ChatMessage[]>([])

export const chatMessageAtomsAtom = splitAtom(chatMessagesAtom, (message) => message.id)

export const artifactsAtom = atom<ArtifactEntry[]>([])
export const sessionTokensAtom = atom<number>(0)
export const lifetimeTokensAtom = atom<number>(0)

export const sidebarExpandedAtom = atomWithStorage<boolean>('orchcode_sidebar_expanded', true)

export const activeWorkspaceAtom = atom<{ name: string; path: string } | null>(null)

export const isArtifactPanelOpenAtom = atom<boolean>(false)
export const artifactPanelModeAtom = atom<ArtifactPanelMode>('overview')
export const openFilesAtom = atom<import('./types').EditorFile[]>([])

const baseActiveEditorFileAtom = atom<import('./types').EditorFile | null>(null)
export const activeEditorFileAtom = atom(
  (get) => get(baseActiveEditorFileAtom),
  (get, set, file: import('./types').EditorFile | null) => {
    set(baseActiveEditorFileAtom, file)
    if (file) {
      const open = get(openFilesAtom)
      set(openFilesAtom, open.some(f => f.path === file.path) ? open.map(f => f.path === file.path ? file : f) : [...open, file])
    }
  }
)

export const hasMessagesAtom = atom<boolean>((get) => get(chatMessagesAtom).length > 0)

export const globalPromptTriggerAtom = atom<{
  prompt: string
  mode?: string
  threadId?: string
} | null>(null)

export const availableModelsAtom = atom<Record<string, ModelInfo>>({})
export const selectedModelAtom = atomWithStorage<string>('orchcode_selected_model', '')

export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })

export const authUserAtom = atom<UserProfile | null>(null)
