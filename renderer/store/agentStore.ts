import { atom } from 'jotai'
import { splitAtom, atomWithStorage } from 'jotai/utils'
import type { ThreadEntry, ArtifactEntry, UpdateStatus, UserProfile } from '../../preload/index.d'

export type { StreamBlock, EditorFile, ChatMessage, ToolCallEntry } from './types'

// 'streaming' removed — we never set it, the model is either thinking or calling tools
type AgentRunState = 'idle' | 'thinking' | 'tool-calling' | 'error'
export type ArtifactPanelMode = 'editor' | 'terminal' | 'browser' | 'overview'
interface ModelInfo { id: string; name: string; multimodal?: boolean; contextWindow?: number }

export const activeThreadIdAtom = atom<string>('')
export const threadListAtom = atom<ThreadEntry[]>([])
export const activeThreadAtom = atom<ThreadEntry | undefined>((get) => {
  const threads = get(threadListAtom), activeId = get(activeThreadIdAtom)
  return threads.find(t => t.id === activeId)
})
export const isThreadLoadingAtom = atom<boolean>(false)

// Scoped maps — keyed by threadId
const chatMessagesMapAtom = atom<Record<string, import('./types').ChatMessage[]>>({})
const agentRunStateMapAtom = atom<Record<string, AgentRunState>>({})
const threadTokensMapAtom = atom<Record<string, { session: number; lifetime: number }>>({})
const threadWorkspaceMapAtom = atom<Record<string, { name: string; path: string } | null>>({})
const threadArtifactsMapAtom = atom<Record<string, ArtifactEntry[]>>({})
const threadOpenFilesMapAtom = atom<Record<string, import('./types').EditorFile[]>>({})
const threadActiveEditorFileMapAtom = atom<Record<string, import('./types').EditorFile | null>>({})
const threadBrowserUrlMapAtom = atom<Record<string, string>>({})

export const threadBrowserUrlAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadBrowserUrlMapAtom)[id] ?? 'https://google.com') : 'https://google.com' },
  (get, set, update: string | ((prev: string) => string)) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadBrowserUrlMapAtom), v = m[id] ?? 'https://google.com'
    set(threadBrowserUrlMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)

// Active-thread-scoped derived atoms
export const chatMessagesAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(chatMessagesMapAtom)[id] ?? []) : [] },
  (get, set, update: import('./types').ChatMessage[] | ((prev: import('./types').ChatMessage[]) => import('./types').ChatMessage[])) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(chatMessagesMapAtom), v = m[id] ?? []
    set(chatMessagesMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)
export const agentRunStateAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(agentRunStateMapAtom)[id] ?? 'idle') : 'idle' as AgentRunState },
  (get, set, update: AgentRunState | ((prev: AgentRunState) => AgentRunState)) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(agentRunStateMapAtom), v = m[id] ?? 'idle' as AgentRunState
    set(agentRunStateMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)
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
export const activeWorkspaceAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadWorkspaceMapAtom)[id] ?? null) : null },
  (get, set, update: { name: string; path: string } | null | ((prev: { name: string; path: string } | null) => { name: string; path: string } | null)) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadWorkspaceMapAtom), v = m[id] ?? null
    set(threadWorkspaceMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)
export const artifactsAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadArtifactsMapAtom)[id] ?? []) : [] },
  (get, set, update: ArtifactEntry[] | ((prev: ArtifactEntry[]) => ArtifactEntry[])) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadArtifactsMapAtom), v = m[id] ?? []
    set(threadArtifactsMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)
export const openFilesAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadOpenFilesMapAtom)[id] ?? []) : [] },
  (get, set, update: import('./types').EditorFile[] | ((prev: import('./types').EditorFile[]) => import('./types').EditorFile[])) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadOpenFilesMapAtom), v = m[id] ?? []
    set(threadOpenFilesMapAtom, { ...m, [id]: typeof update === 'function' ? update(v) : update })
  }
)
export const activeEditorFileAtom = atom(
  (get) => { const id = get(activeThreadIdAtom); return id ? (get(threadActiveEditorFileMapAtom)[id] ?? null) : null },
  (get, set, file: import('./types').EditorFile | null) => {
    const id = get(activeThreadIdAtom); if (!id) return
    const m = get(threadActiveEditorFileMapAtom)
    set(threadActiveEditorFileMapAtom, { ...m, [id]: file })
    if (file) { const open = get(openFilesAtom); set(openFilesAtom, open.some(f => f.path === file.path) ? open.map(f => f.path === file.path ? file : f) : [...open, file]) }
  }
)

// Thread-targeted update atoms (for background events/IPC streams updating non-active threads)
export const updateThreadMessagesAtom = atom(null, (get, set, { threadId, update }: { threadId: string; update: import('./types').ChatMessage[] | ((prev: import('./types').ChatMessage[]) => import('./types').ChatMessage[]) }) => {
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
export const updateThreadOpenFilesAtom = atom(null, (get, set, { threadId, openFiles }: { threadId: string; openFiles: import('./types').EditorFile[] }) => {
  set(threadOpenFilesMapAtom, { ...get(threadOpenFilesMapAtom), [threadId]: openFiles })
})
export const updateThreadActiveEditorFileAtom = atom(null, (get, set, { threadId, file }: { threadId: string; file: import('./types').EditorFile | null }) => {
  set(threadActiveEditorFileMapAtom, { ...get(threadActiveEditorFileMapAtom), [threadId]: file })
})

export const chatMessageAtomsAtom = splitAtom(chatMessagesAtom, (message) => message.id)
export const runningThreadsAtom = atom<Set<string>>(new Set<string>())
export const sidebarExpandedAtom = atomWithStorage<boolean>('orchcode_sidebar_expanded', true)
export const isArtifactPanelOpenAtom = atom<boolean>(false)
export const artifactPanelModeAtom = atom<ArtifactPanelMode>('overview')
export const hasMessagesAtom = atom<boolean>((get) => get(chatMessagesAtom).length > 0)
export const globalPromptTriggerAtom = atom<{ prompt: string; mode?: string; threadId?: string } | null>(null)
export const availableModelsAtom = atom<Record<string, ModelInfo>>({})
export const selectedModelAtom = atomWithStorage<string>('orchcode_selected_model', '')
export const updateStatusAtom = atom<UpdateStatus>({ status: 'idle' })
export const authUserAtom = atom<UserProfile | null>(null)
export const isDiffModeAtom = atom<boolean>(false)
