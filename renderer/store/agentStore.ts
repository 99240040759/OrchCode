import { atom, type WritableAtom, type Getter, type Setter } from 'jotai'
import { atomWithStorage, splitAtom } from 'jotai/utils'
import type { ThreadEntry, ArtifactEntry, UpdateStatus, UserProfile } from '../../preload/index.d'
import type { ChatMessage, EditorFile } from './types'

export type { StreamBlock, EditorFile, ChatMessage, ToolCallEntry } from './types'

type AgentRunState = 'idle' | 'thinking' | 'tool-calling' | 'error'
export type ArtifactPanelMode = 'editor' | 'terminal' | 'browser' | 'overview'
interface ModelInfo { id: string; name: string; multimodal?: boolean; contextWindow?: number; badge?: string | null }

export const activeThreadIdAtom = atom<string>('')
export const threadListAtom = atom<ThreadEntry[]>([])
export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom), activeId = get(activeThreadIdAtom)
  return threads.find(t => t.id === activeId)
})
export const isThreadLoadingAtom = atom<boolean>(false)

function threadScopedAtom<T>(mapAtom: WritableAtom<Record<string, T>, [Record<string, T>], void>, defaultValue: T) {
  return atom(
    (get: Getter) => { const id = get(activeThreadIdAtom); return id ? (get(mapAtom)[id] ?? defaultValue) : defaultValue },
    (get: Getter, set: Setter, update: T | ((prev: T) => T)) => {
      const id = get(activeThreadIdAtom); if (!id) return
      const m = get(mapAtom), v = m[id] ?? defaultValue
      set(mapAtom, { ...m, [id]: typeof update === 'function' ? (update as (prev: T) => T)(v) : update })
    }
  )
}


const chatMessagesMapAtom = atom<Record<string, ChatMessage[]>>({})
const agentRunStateMapAtom = atom<Record<string, AgentRunState>>({})
const threadTokensMapAtom = atom<Record<string, { session: number; lifetime: number }>>({})
const threadWorkspaceMapAtom = atom<Record<string, { name: string; path: string } | null>>({})
const threadArtifactsMapAtom = atom<Record<string, ArtifactEntry[]>>({})
const threadOpenFilesMapAtom = atom<Record<string, EditorFile[]>>({})
const threadActiveEditorFileMapAtom = atom<Record<string, EditorFile | null>>({})
const threadBrowserUrlMapAtom = atom<Record<string, string>>({})

export const threadBrowserUrlAtom = threadScopedAtom(threadBrowserUrlMapAtom, 'https://google.com')
export const chatMessagesAtom = threadScopedAtom(chatMessagesMapAtom, [] as ChatMessage[])
export const chatMessageAtomsAtom = splitAtom(chatMessagesAtom)
export const agentRunStateAtom = threadScopedAtom(agentRunStateMapAtom, 'idle' as AgentRunState)
export const sessionTokensAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadTokensMapAtom)[id]?.session ?? 0) : 0 },
  (get, set, update: number | ((prev: number) => number)) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadTokensMapAtom), v = m[id] ?? { session: 0, lifetime: 0 }
    set(threadTokensMapAtom, { ...m, [id]: { ...v, session: typeof update === 'function' ? update(v.session) : update } })
  }
)
export const lifetimeTokensAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadTokensMapAtom)[id]?.lifetime ?? 0) : 0 },
  (get, set, update: number | ((prev: number) => number)) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadTokensMapAtom), v = m[id] ?? { session: 0, lifetime: 0 }
    set(threadTokensMapAtom, { ...m, [id]: { ...v, lifetime: typeof update === 'function' ? update(v.lifetime) : update } })
  }
)
export const activeWorkspaceAtom = threadScopedAtom(threadWorkspaceMapAtom, null as { name: string; path: string } | null)
export const artifactsAtom = threadScopedAtom(threadArtifactsMapAtom, [] as ArtifactEntry[])
export const openFilesAtom = threadScopedAtom(threadOpenFilesMapAtom, [] as EditorFile[])
export const activeEditorFileAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadActiveEditorFileMapAtom)[id] ?? null) : null },
  (get, set, file: EditorFile | null) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadActiveEditorFileMapAtom)
    set(threadActiveEditorFileMapAtom, { ...m, [id]: file })
    if (file) { const open = get(openFilesAtom); set(openFilesAtom, open.some(f => f.path === file.path) ? open.map(f => f.path === file.path ? file : f) : [...open, file]) }
  }
)

export const updateThreadMessagesAtom = atom(null, (get, set, { threadId, update }: { threadId: string; update: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]) }) => {
  const m = get(chatMessagesMapAtom), v = m[threadId] ?? []
  set(chatMessagesMapAtom, { ...m, [threadId]: typeof update === 'function' ? update(v) : update })
})
export const updateThreadRunStateAtom = atom(null, (get, set, { threadId, state }: { threadId: string; state: AgentRunState }) => {
  set(agentRunStateMapAtom, { ...get(agentRunStateMapAtom), [threadId]: state })
})
export const updateThreadTokensAtom = atom(null, (get, set, { threadId, session, lifetime }: { threadId: string; session?: number; lifetime?: number }) => {
  const m = get(threadTokensMapAtom), v = m[threadId] ?? { session: 0, lifetime: 0 }
  set(threadTokensMapAtom, { ...m, [threadId]: { session: session !== undefined ? session : v.session, lifetime: lifetime !== undefined ? lifetime : v.lifetime } })
})
export const updateThreadWorkspaceAtom = atom(null, (get, set, { threadId, workspace }: { threadId: string; workspace: { name: string; path: string } | null }) => {
  set(threadWorkspaceMapAtom, { ...get(threadWorkspaceMapAtom), [threadId]: workspace })
})
export const updateThreadArtifactsAtom = atom(null, (get, set, { threadId, artifacts }: { threadId: string; artifacts: ArtifactEntry[] }) => {
  set(threadArtifactsMapAtom, { ...get(threadArtifactsMapAtom), [threadId]: artifacts })
})
export const updateThreadOpenFilesAtom = atom(null, (get, set, { threadId, openFiles }: { threadId: string; openFiles: EditorFile[] }) => {
  set(threadOpenFilesMapAtom, { ...get(threadOpenFilesMapAtom), [threadId]: openFiles })
})
export const updateThreadActiveEditorFileAtom = atom(null, (get, set, { threadId, file }: { threadId: string; file: EditorFile | null }) => {
  set(threadActiveEditorFileMapAtom, { ...get(threadActiveEditorFileMapAtom), [threadId]: file })
})

export const runningThreadsAtom = atom<Set<string>>(new Set<string>())
export const sidebarExpandedAtom = atomWithStorage<boolean>('orchcode_sidebar_expanded', true)
export const isArtifactPanelOpenAtom = atom<boolean>(false)
export const artifactPanelModeAtom = atom<ArtifactPanelMode>('overview')
export const isDiffModeAtom = atom<boolean>(false)
export const hasMessagesAtom = atom<boolean>((get) => get(chatMessagesAtom).length > 0)
export const globalPromptTriggerAtom = atom<{ prompt: string; mode?: string; threadId?: string } | null>(null)
export const availableModelsAtom = atom<Record<string, ModelInfo>>({})
export const selectedModelAtom = atomWithStorage<string>('orchcode_selected_model', '')
export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })
export const authUserAtom = atom<UserProfile | null>(null)

const pendingApprovalMapAtom = atom<Record<string, { toolCallId: string; toolName: string; args: Record<string, any> } | null>>({})
export const pendingApprovalAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(pendingApprovalMapAtom)[id] ?? null) : null },
  (get, set, update: { toolCallId: string; toolName: string; args: Record<string, any> } | null) => {
    const id = get(activeThreadIdAtom); if (!id) return
    set(pendingApprovalMapAtom, { ...get(pendingApprovalMapAtom), [id]: update })
  }
)
export const updatePendingApprovalAtom = atom(null, (get, set, { threadId, approval }: { threadId: string; approval: { toolCallId: string; toolName: string; args: Record<string, any> } | null }) => {
  set(pendingApprovalMapAtom, { ...get(pendingApprovalMapAtom), [threadId]: approval })
})
