import { create } from 'zustand'
import { produce } from 'immer'
import type { StreamState, WorkspaceFolder } from './types'
import { extractFilePath } from './types'
import type {
  SessionHistoryRecord,
  MessageWithMetadata,
  ContentBlock,
  SessionPendingPrompt,
  CoreSessionEvent
} from '@cline/sdk'
import type { AgentEvent } from '@cline/shared'
import type { ModelConfig } from '../../shared/ipc-contracts'
import * as Sentry from '@sentry/electron/renderer'
import { toast } from './toast'
import { UiSlice, createUiSlice } from './slices/uiSlice'
import { normalizePathForComparison } from '../../shared/pathHelpers'

const portMap = new Map<string, MessagePort>()
const streamTextBuffers = new Map<string, string>()
const streamReasoningBuffers = new Map<string, string>()
const scheduledFrames = new Map<string, number>()
const MAX_STREAM_TEXT_LENGTH = 2 * 1024 * 1024
const MAX_TOOL_OUTPUT_LENGTH = 128 * 1024
const fileTreeCache = new Map<string, { tree: string[]; at: number }>()
const fileTreeLoads = new Map<string, Promise<string[]>>()
const modelChangeVersions = new Map<string, number>()
const reasoningChangeVersions = new Map<string, number>()
function pathsEqual(p1: string | undefined, p2: string | undefined): boolean {
  if (!p1 || !p2) return p1 === p2
  return normalizePathForComparison(p1, window.api.platform) === normalizePathForComparison(p2, window.api.platform)
}
function matchModelKey(models: Record<string, ModelConfig>, modelId: string | undefined): string | undefined {
  if (!modelId) return undefined
  const targetId = modelId.split('/').pop()
  if (!targetId) return undefined
  return Object.keys(models).find((k) => {
    const mid = models[k]?.id
    if (!mid) return false
    return mid === modelId || mid.split('/').pop() === targetId
  })
}
const defaultStream = (): StreamState => ({
  isLoading: false,
  text: '',
  reasoning: '',
  tools: [],
  statusNotice: undefined,
  error: undefined
})

function cleanupSessionPort(sessionId: string): void {
  const port = portMap.get(sessionId)
  if (port) {
    try {
      port.onmessage = null
      port.close()
    } catch (err: unknown) {
      Sentry.captureException(err)
    }
    portMap.delete(sessionId)
    window.postMessage({ type: 'session:unregister-port-transfer', sessionId }, window.location.origin)
  }
  compactionActive.delete(sessionId)
  const timer = refreshTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    refreshTimers.delete(sessionId)
  }
  messageRequestVersions.delete(sessionId)
  const frame = scheduledFrames.get(sessionId)
  if (frame) {
    clearTimeout(frame)
    scheduledFrames.delete(sessionId)
  }
  streamTextBuffers.delete(sessionId)
  streamReasoningBuffers.delete(sessionId)
}

let _askQuestionUnsub: (() => void) | undefined = undefined
let _askQuestionDismissUnsub: (() => void) | undefined = undefined
let _coreInitFailedUnsub: (() => void) | undefined = undefined

type PortEvent = CoreSessionEvent | { type: 'error'; payload: { error: string } }

let initPromise: Promise<void> | undefined = undefined
let sessionCreationPromise: Promise<string | undefined> | undefined = undefined
let lifecycleVersion = 0
let activeFileRequest = 0
let fileTreeRequest = 0
const messageRequestVersions = new Map<string, number>()
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
const compactionActive = new Set<string>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? '' : serialized.slice(0, MAX_TOOL_OUTPUT_LENGTH)
  } catch {
    return String(value).slice(0, MAX_TOOL_OUTPUT_LENGTH)
  }
}

function eventError(value: unknown): string {
  if (typeof value === 'string' && value) return value
  const record = asRecord(value)
  if (typeof record.message === 'string' && record.message) return record.message
  return value ? String(value) : 'Agent run failed'
}



export interface ThreadStoreState extends UiSlice {
  sessions: SessionHistoryRecord[]
  currentSessionId: string | undefined
  messagesMap: Record<string, MessageWithMetadata[]>
  streamStates: Record<string, StreamState>
  openFolders: WorkspaceFolder[]
  activeFolderPath: string | undefined
  activeFilePath: string | undefined
  activeFileContent: string | undefined
  openFiles: string[]
  fileTree: string[] | undefined
  initialized: boolean
  models: Record<string, ModelConfig>
  selectedModelKey: string | undefined
  queuesMap: Record<string, SessionPendingPrompt[]>
  init: () => Promise<void>
  createSession: (title: string, workspacePath?: string) => Promise<string | undefined>
  selectSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (
    text: string,
    userImages?: string[],
    userFiles?: string[],
    delivery?: 'queue' | 'steer'
  ) => Promise<boolean>
  abortSession: (sessionId: string) => Promise<void>
  setActiveFile: (filePath: string | undefined) => Promise<void>
  closeFile: (filePath: string) => void
  loadFileTree: (dirPath: string) => Promise<void>
  openFolderDialog: () => Promise<void>
  workspaceRemoveFolder: (path: string) => Promise<void>
  setActiveFolderPath: (path: string | undefined) => void
  changeSessionModel: (modelKey: string) => Promise<void>
  changeSessionReasoning: (reasoningEffort: string | null) => Promise<void>
  updateQueuePrompt: (
    promptId: string,
    text: string,
    delivery: 'queue' | 'steer'
  ) => Promise<boolean>
  deleteQueuePrompt: (promptId: string) => Promise<boolean>
  reset: () => void
  renameSession: (sessionId: string, newTitle: string) => Promise<void>
}

export const useThreadStore = create<ThreadStoreState>((set, get, api) => ({
  ...createUiSlice(set, get, api),
  sessions: [],
  currentSessionId: undefined,
  messagesMap: {},
  streamStates: {},
  openFolders: [],
  activeFolderPath: undefined,
  activeFilePath: undefined,
  activeFileContent: undefined,
  openFiles: [],
  fileTree: undefined,
  initialized: false,
  models: {},
  selectedModelKey: undefined,
  queuesMap: {},
  init: async () => {
    if (get().initialized) return
    if (initPromise) return initPromise
    const version = ++lifecycleVersion
    _askQuestionUnsub?.()
    _askQuestionDismissUnsub?.()
    _coreInitFailedUnsub?.()
    _coreInitFailedUnsub = window.api.onCoreInitFailed(({ message }) => {
      if (version === lifecycleVersion) toast.error(message)
    })
    _askQuestionUnsub = window.api.onAskQuestion((info) => {
      if (version === lifecycleVersion)
        set((state) => ({
          activeQuestions: state.activeQuestions.some((question) => question.id === info.id)
            ? state.activeQuestions
            : [...state.activeQuestions, info]
        }))
    })
    _askQuestionDismissUnsub = window.api.onAskQuestionDismiss(({ id }) => {
      if (version !== lifecycleVersion) return
      set((state) => ({
        activeQuestions: state.activeQuestions.filter((question) => question.id !== id)
      }))
    })
    initPromise = (async () => {
      try {
        const [rawSessions, folders, rawModels] = await Promise.all([
          window.api.sessionList(),
          window.api.workspaceGetFolders(),
          window.api.modelsList()
        ])
        if (version !== lifecycleVersion) return
        const sessions = rawSessions
        const models = rawModels as Record<string, ModelConfig>
        const lastSession = sessions.reduce<SessionHistoryRecord | undefined>(
          (latest, session) =>
            !latest ||
            (session.startedAt ? Date.parse(session.startedAt) : 0) >
              (latest.startedAt ? Date.parse(latest.startedAt) : 0)
              ? session
              : latest,
          undefined
        )
        upd((d) => {
          d.sessions = sessions
          d.openFolders = folders.map((f) => ({
            path: f.rootPath,
            name: f.hint || '',
            associatedRemoteUrls: f.associatedRemoteUrls,
            latestGitCommitHash: f.latestGitCommitHash,
            latestGitBranchName: f.latestGitBranchName
          }))
          d.models = models
          d.selectedModelKey = Object.keys(models)[0]
          d.queuesMap = {} // TS-10
        })
        if (lastSession) {
          if (version !== lifecycleVersion) return
          const resolvedWorkspace = lastSession.workspaceRoot || undefined
          upd((d) => {
            d.currentSessionId = lastSession.sessionId
            d.activeFolderPath = resolvedWorkspace
          })
          await doRefreshMessages(lastSession.sessionId)
          if (version !== lifecycleVersion) return
          setupSessionPort(lastSession.sessionId)
          if (resolvedWorkspace) void get().loadFileTree(resolvedWorkspace)
        }
      } catch (err: unknown) {
        console.error('[ThreadStore] init failed:', err)
        throw err
      }
    })()
    try {
      await initPromise
      if (version === lifecycleVersion) set({ initialized: true })
    } catch (err: unknown) {
      toast.error('Failed to initialize session manager.', err)
    } finally {
      if (version === lifecycleVersion) initPromise = undefined
    }
  },
  createSession: async (title, workspacePath) => {
    if (sessionCreationPromise) return sessionCreationPromise
    sessionCreationPromise = (async () => {
      const modelKey = get().selectedModelKey || Object.keys(get().models)[0]
      let res
      try {
        res = await window.api.sessionCreate({ title, workspacePath, modelKey })
      } catch (err: unknown) {
        toast.error('Failed to create session.', err)
        return undefined
      }
      if (!res || 'error' in res) {
        if (res && 'error' in res)
          toast.error('Failed to create new session.', new Error(res.error as string))
        return undefined
      }
      const { sessionId, title: actualTitle } = res as { sessionId: string; title: string }
      const modelCfg = modelKey ? get().models[modelKey] : undefined
      const newSession: SessionHistoryRecord = {
        sessionId,
        metadata: { title: actualTitle },
        workspaceRoot: workspacePath ?? '',
        status: 'idle',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        interactive: true,
        enableTools: true,
        enableSpawn: false,
        enableTeams: false,
        isSubagent: false,
        cwd: workspacePath ?? '',
        model: modelCfg?.id ?? '',
        provider: modelCfg?.provider ?? '',
        source: 'local'
      }
      upd((d) => {
        if (!d.sessions.some((s) => s.sessionId === sessionId)) d.sessions.push(newSession)
        d.currentSessionId = sessionId
        d.messagesMap[sessionId] = []
        d.streamStates[sessionId] = defaultStream()
        if (workspacePath) d.activeFolderPath = workspacePath
      })
      if (workspacePath) void get().loadFileTree(workspacePath)
      setupSessionPort(sessionId)
      return sessionId
    })()
    try {
      return await sessionCreationPromise
    } finally {
      sessionCreationPromise = undefined
    }
  },
  selectSession: async (sessionId) => {
    const session = get().sessions.find((s) => s.sessionId === sessionId)
    const rawPath = session?.workspaceRoot || undefined
    const openFolderPaths = new Set(get().openFolders.map((f) => normalizePathForComparison(f.path, window.api.platform)))
    const wsNormalized = rawPath ? normalizePathForComparison(rawPath, window.api.platform) : ''
    const workspacePath = rawPath && openFolderPaths.has(wsNormalized) ? rawPath : undefined
    upd((d) => {
      d.currentSessionId = sessionId
      d.activeFolderPath = workspacePath
      d.openFiles = []
      d.activeFilePath = undefined
      d.activeFileContent = undefined
      d.showBrowser = false
    })
    setupSessionPort(sessionId)
    if (workspacePath) void get().loadFileTree(workspacePath)
    const existingMsgs = get().messagesMap[sessionId]
    if (get().streamStates[sessionId]?.isLoading && existingMsgs && existingMsgs.length > 0) {
      useThreadStore.setState((s) => ({
        streamStates: { ...s.streamStates, [sessionId]: defaultStream() }
      }))
    }
    if (!existingMsgs) refreshMessages(sessionId)
    try {
      const queues = await window.api.queueList({ sessionId })
      upd((d) => {
        d.queuesMap[sessionId] = queues
      })
    } catch (e) {
      console.error('Failed to list queue', e)
      Sentry.captureException(e)
    }
    if (!workspacePath)
      upd((d) => {
        d.fileTree = undefined
      })
    const matched = matchModelKey(get().models, session?.model)
    upd((d) => {
      d.selectedModelKey = matched ?? Object.keys(get().models)[0]
    })
  },
  deleteSession: async (sessionId) => {
    const ok = await window.api.sessionDelete({ sessionId }).catch((err: unknown) => {
      toast.error('Failed to delete session.', err)
      return false
    })
    if (!ok) return
    cleanupSessionPort(sessionId)
    let nextSessionId: string | undefined = undefined
    let isCurrent = false
    upd((d) => {
      d.sessions = d.sessions.filter((s) => s.sessionId !== sessionId)
      delete d.messagesMap[sessionId]
      delete d.streamStates[sessionId]
      delete d.queuesMap[sessionId]
      if (d.currentSessionId === sessionId) {
        isCurrent = true
        const next = d.sessions[d.sessions.length - 1]
        nextSessionId = next?.sessionId
      }
    })
    if (nextSessionId) {
      await get().selectSession(nextSessionId)
    } else if (isCurrent) {
      // No next session — clear all artifact/file panel state
      upd((d) => {
        d.currentSessionId = undefined
        d.activeFolderPath = undefined
        d.openFiles = []
        d.activeFilePath = undefined
        d.activeFileContent = undefined
        d.artifactOpen = false
        d.showBrowser = false
        d.fileTree = undefined
      })
    }
  },
  renameSession: async (sessionId, newTitle) => {
    try {
      const updated = await window.api.sessionUpdateTitle({ sessionId, title: newTitle })
      if (!updated) {
        toast.error('Failed to rename session.')
        return
      }
      upd((d) => {
        const session = d.sessions.find((s) => s.sessionId === sessionId)
        if (session) {
          if (!session.metadata) session.metadata = {}
          session.metadata.title = newTitle
        }
      })
    } catch (err: unknown) {
      toast.error('Failed to rename session.', err)
    }
  },
  sendMessage: async (text, userImages, userFiles, delivery) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return false
    const isQueue = delivery === 'queue'
    if (!isQueue && get().streamStates[sessionId]?.isLoading) return false
    const workspacePath = get().activeFolderPath
    const currentSession = get().sessions.find((s) => s.sessionId === sessionId)
    if (currentSession && !currentSession.workspaceRoot && workspacePath) {
      try {
        await window.api.workspaceAddFolder({ path: workspacePath, name: '' })
        upd((d) => {
          if (!d.openFolders.find((f) => pathsEqual(f.path, workspacePath)))
            d.openFolders.push({ path: workspacePath, name: '' })
        })
      } catch (err: unknown) {
        Sentry.captureException(err)
      }
    }

    let optimisticId: string | undefined = undefined
    if (!isQueue) {
      optimisticId = `optimistic-${Date.now()}`
      const optimisticAttachments: ContentBlock[] = []
      if (userImages)
        userImages.forEach((img) =>
          optimisticAttachments.push({ type: 'image', data: img, mediaType: 'image/png' })
        )
      if (userFiles)
        userFiles.forEach((file) =>
          optimisticAttachments.push({ type: 'file', path: file, content: '' })
        )
      const userMsg: MessageWithMetadata = {
        id: optimisticId,
        role: 'user',
        content: [{ type: 'text', text }, ...optimisticAttachments],
        ts: Date.now()
      }
      upd((d) => {
        if (!d.messagesMap[sessionId]) d.messagesMap[sessionId] = []
        d.messagesMap[sessionId].push(userMsg)
        d.streamStates[sessionId] = { ...defaultStream(), isLoading: true }
      })
    }
    // Track if this was a draft session — we'll refresh after promotion
    const wasDraft = sessionId.startsWith('draft_')
    try {
      const sent = await window.api.sessionSend({
        sessionId,
        prompt: text,
        userImages,
        userFiles,
        delivery
      })
      if (!sent) throw new Error('The message could not be sent. Please try again.')
      if (wasDraft) {
        window.api.sessionList().then((rawSessions) => {
          if (rawSessions.length > 0) useThreadStore.setState({ sessions: rawSessions })
        }).catch(() => {})
      }
      return true
    } catch (err: unknown) {
      toast.error('Failed to send message.', err)
      const errMsg = err instanceof Error ? err.message : String(err)
      if (optimisticId) {
        useThreadStore.setState((s) => {
          const ss = s.streamStates[sessionId]
          const msgs = s.messagesMap[sessionId] ?? []
          return {
            streamStates: {
              ...s.streamStates,
              [sessionId]: ss ? { ...ss, isLoading: false, error: errMsg } : defaultStream()
            },
            messagesMap: {
              ...s.messagesMap,
              [sessionId]: msgs.filter((m) => m.id !== optimisticId)
            }
          }
        })
      }
      return false
    }
  },
  abortSession: async (sessionId) => {
    await window.api.sessionAbort({ sessionId })
  },
  setActiveFile: async (filePath) => {
    const request = ++activeFileRequest
    upd((d) => {
      d.activeFilePath = filePath
      d.activeFileContent = undefined
      if (filePath) {
        d.artifactOpen = true
        if (!d.openFiles.includes(filePath)) d.openFiles.push(filePath)
      }
    })
    if (!filePath) return
    try {
      const content = await window.api.fileRead({ filePath })
      if (request !== activeFileRequest || get().activeFilePath !== filePath) return
      upd((d) => {
        d.activeFileContent = content ?? undefined
      })
    } catch (err: unknown) {
      toast.error('Failed to read file contents.', err)
    }
  },
  closeFile: (filePath) => {
    const openFiles = get().openFiles.filter((f) => f !== filePath)
    const needsSwitch = get().activeFilePath === filePath
    const nextFile =
      needsSwitch && openFiles.length > 0 ? openFiles[openFiles.length - 1] : undefined
    upd((d) => {
      d.openFiles = openFiles
      if (needsSwitch && !nextFile) {
        d.activeFilePath = undefined
        d.activeFileContent = undefined
      }
    })
    if (nextFile) void get().setActiveFile(nextFile)
  },
  loadFileTree: async (dirPath) => {
    const request = ++fileTreeRequest
    try {
      const key = normalizePathForComparison(dirPath, window.api.platform)
      const cached = fileTreeCache.get(key)
      let tree: string[]
      if (cached && Date.now() - cached.at < 2_000) tree = cached.tree
      else {
        let load = fileTreeLoads.get(key)
        if (!load) {
          load = window.api
            .fileList({ dirPath })
            .then((result) => {
              const next = result ?? []
              fileTreeCache.set(key, { tree: next, at: Date.now() })
              return next
            })
            .finally(() => fileTreeLoads.delete(key))
          fileTreeLoads.set(key, load)
        }
        tree = await load
      }
      if (request !== fileTreeRequest) return
      upd((d) => {
        d.fileTree = tree
      })
    } catch (err: unknown) {
      Sentry.captureException(err)
    }
  },
  openFolderDialog: async () => {
    try {
      const folder = await window.api.workspaceOpenDialog()
      if (folder)
        upd((d) => {
          const path = folder.rootPath
          if (!d.openFolders.find((f) => f.path === path))
            d.openFolders.push({
              path,
              name: folder.hint || '',
              associatedRemoteUrls: folder.associatedRemoteUrls,
              latestGitCommitHash: folder.latestGitCommitHash,
              latestGitBranchName: folder.latestGitBranchName
            })
        })
    } catch (err: unknown) {
      toast.error('Failed to open directory dialog.', err)
    }
  },
  workspaceRemoveFolder: async (path) => {
    const related = get().sessions.filter((s) => pathsEqual(s.workspaceRoot ?? s.cwd, path))
    const relatedIds = related.map((s) => s.sessionId)
    const deletionResults = await Promise.all(
      relatedIds.map(async (id) => {
        try {
          return await window.api.sessionDelete({ sessionId: id })
        } catch (err: unknown) {
          Sentry.captureException(err, { extra: { sessionId: id } })
          return false
        }
      })
    )
    if (deletionResults.some((deleted) => !deleted)) {
      toast.error('Could not remove every session in this workspace.')
      return
    }
    const removed = await window.api.workspaceRemoveFolder({ path }).catch((err: unknown) => {
      toast.error('Failed to remove repository folder.', err)
      return false
    })
    if (!removed) return
    for (const id of relatedIds) cleanupSessionPort(id)
    let nextSessionId: string | undefined = undefined
    upd((d) => {
      d.sessions = d.sessions.filter((s) => !pathsEqual(s.workspaceRoot ?? s.cwd, path))
      for (const id of relatedIds) {
        delete d.messagesMap[id]
        delete d.streamStates[id]
        delete d.queuesMap[id]
      }
      d.openFolders = d.openFolders.filter((f) => !pathsEqual(f.path, path))
      if (pathsEqual(d.activeFolderPath, path)) {
        d.activeFolderPath = undefined
        if (d.currentSessionId && relatedIds.includes(d.currentSessionId)) {
          const next = d.sessions[d.sessions.length - 1]
          d.currentSessionId = next?.sessionId
          d.activeFolderPath = next?.workspaceRoot ?? next?.cwd ?? undefined
          nextSessionId = next?.sessionId
        }
        d.openFiles = []
        d.activeFilePath = undefined
        d.activeFileContent = undefined
        d.fileTree = undefined
        d.showBrowser = false
      }
    })
    if (nextSessionId) await get().selectSession(nextSessionId)
  },
  setActiveFolderPath: (path) => {
    upd((d) => {
      d.activeFolderPath = path
      if (!path) d.fileTree = undefined
    })
    if (path) get().loadFileTree(path)
  },
  changeSessionModel: async (modelKey: string) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    const prevKey = get().selectedModelKey
    const version = (modelChangeVersions.get(sessionId) ?? 0) + 1
    modelChangeVersions.set(sessionId, version)
    upd((d) => {
      d.selectedModelKey = modelKey
    })
    let ok = false
    try {
      const res = await window.api.sessionUpdateModel({ sessionId, modelKey })
      ok = !!res.success
      if (!ok) {
        toast.error('Failed to change session model.')
      }
    } catch (err: unknown) {
      toast.error('Failed to update session model.', err)
      ok = false
    }
    if (modelChangeVersions.get(sessionId) !== version) return
    if (ok) {
      upd((d) => {
        const s = d.sessions.find((x) => x.sessionId === sessionId)
        if (s) {
          s.model = d.models[modelKey]?.id ?? ''
          s.provider = d.models[modelKey]?.provider ?? ''
        }
      })
    } else {
      if (get().currentSessionId === sessionId) upd((d) => { d.selectedModelKey = prevKey })
    }
  },
  changeSessionReasoning: async (reasoningEffort: string | null) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    const previousReasoning = get().sessions.find((session) => session.sessionId === sessionId)?.metadata
      ?.reasoningEffort as string | null | undefined
    const version = (reasoningChangeVersions.get(sessionId) ?? 0) + 1
    reasoningChangeVersions.set(sessionId, version)
    upd((d) => {
      const s = d.sessions.find((x) => x.sessionId === sessionId)
      if (s) s.metadata = { ...s.metadata, reasoningEffort }
    })
    let updated = false
    try {
      const res = await window.api.sessionUpdateReasoning({ sessionId, reasoningEffort })
      updated = !!res.success
      if (!updated) toast.error('Failed to change reasoning effort.')
    } catch (err: unknown) {
      toast.error('Failed to update reasoning effort.', err)
    }
    if (!updated && reasoningChangeVersions.get(sessionId) === version) {
      upd((d) => {
        const session = d.sessions.find((item) => item.sessionId === sessionId)
        if (session) session.metadata = { ...session.metadata, reasoningEffort: previousReasoning ?? null }
      })
    }
  },

  updateQueuePrompt: async (promptId, text, delivery) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return false
    try {
      const updated = await window.api.queueUpdate({ sessionId, promptId, prompt: text, delivery })
      if (updated)
        upd((d) => {
          const item = d.queuesMap[sessionId]?.find((queue) => queue.id === promptId)
          if (item) {
            item.prompt = text
            item.delivery = delivery
          }
        })
      return updated
    } catch (err: unknown) {
      toast.error('Failed to update queued prompt.', err)
      return false
    }
  },
  deleteQueuePrompt: async (promptId) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return false
    try {
      const deleted = await window.api.queueDelete({ sessionId, promptId })
      if (deleted)
        upd((d) => {
          d.queuesMap[sessionId] = (d.queuesMap[sessionId] ?? []).filter(
            (queue) => queue.id !== promptId
          )
        })
      return deleted
    } catch (err: unknown) {
      toast.error('Failed to delete queued prompt.', err)
      return false
    }
  },
  reset: () => {
    lifecycleVersion++
    initPromise = undefined
    activeFileRequest++
    fileTreeRequest++
    _askQuestionUnsub?.()
    _askQuestionUnsub = undefined
    _askQuestionDismissUnsub?.()
    _askQuestionDismissUnsub = undefined
    _coreInitFailedUnsub?.()
    _coreInitFailedUnsub = undefined
    compactionActive.clear()
    messageRequestVersions.clear()
    scheduledFrames.forEach((frame) => clearTimeout(frame))
    scheduledFrames.clear()
    streamTextBuffers.clear()
    streamReasoningBuffers.clear()
    refreshTimers.forEach((timer) => clearTimeout(timer))
    refreshTimers.clear()
    fileTreeCache.clear()
    fileTreeLoads.clear()
    modelChangeVersions.clear()
    reasoningChangeVersions.clear()
    portMap.forEach((p) => {
      try {
        p.onmessage = null
        p.close()
      } catch (err: unknown) {
        Sentry.captureException(err)
      }
    })
    portMap.clear()
    set({
      sessions: [],
      currentSessionId: undefined,
      messagesMap: {},
      streamStates: {},
      openFolders: [],
      activeFolderPath: undefined,
      activeNav: undefined,
      artifactOpen: false,
      activeFilePath: undefined,
      activeFileContent: undefined,
      fileTree: undefined,
      initialized: false,
      models: {},
      selectedModelKey: undefined,
      activeQuestions: [],
      openFiles: [],
      queuesMap: {}
    })
  }
}))

function upd(recipe: (draft: ThreadStoreState) => void): void {
  useThreadStore.setState(produce(recipe))
}

function setStream(
  sessionId: string,
  patch: Partial<StreamState> | ((ss: StreamState) => Partial<StreamState>)
): void {
  useThreadStore.setState((s) => {
    const existing = s.streamStates[sessionId] ?? defaultStream()
    const partial = typeof patch === 'function' ? patch(existing) : patch
    return { streamStates: { ...s.streamStates, [sessionId]: { ...existing, ...partial } } }
  })
}

function scheduleBufferFlush(sessionId: string): void {
  if (scheduledFrames.has(sessionId)) return
  const frameId = window.requestAnimationFrame(() => {
    scheduledFrames.delete(sessionId)
    const nextText = streamTextBuffers.get(sessionId)
    const nextReasoning = streamReasoningBuffers.get(sessionId)
    useThreadStore.setState((s) => {
      const ss = s.streamStates[sessionId] ?? defaultStream()
      const updates: Partial<StreamState> = { isLoading: true }
      if (nextText !== undefined) {
        updates.text = nextText
        streamTextBuffers.delete(sessionId)
      }
      if (nextReasoning !== undefined) {
        updates.reasoning = nextReasoning
        streamReasoningBuffers.delete(sessionId)
      }
      return { streamStates: { ...s.streamStates, [sessionId]: { ...ss, ...updates } } }
    })
  })
  scheduledFrames.set(sessionId, frameId)
}

function flushBuffersImmediately(sessionId: string, finalUpdates?: Partial<StreamState>): void {
  const frame = scheduledFrames.get(sessionId)
  if (frame) {
    cancelAnimationFrame(frame)
    scheduledFrames.delete(sessionId)
  }
  const textVal = streamTextBuffers.get(sessionId)
  const reasoningVal = streamReasoningBuffers.get(sessionId)
  streamTextBuffers.delete(sessionId)
  streamReasoningBuffers.delete(sessionId)
  useThreadStore.setState((s) => {
    const ss = s.streamStates[sessionId] ?? defaultStream()
    const updates: Partial<StreamState> = { ...finalUpdates }
    if ('text' in updates && updates.text === undefined) updates.text = ''
    else if (textVal !== undefined) updates.text = textVal
    if ('reasoning' in updates && updates.reasoning === undefined) updates.reasoning = ''
    else if (reasoningVal !== undefined) updates.reasoning = reasoningVal
    return { streamStates: { ...s.streamStates, [sessionId]: { ...ss, ...updates } } }
  })
}

function refreshMessages(sessionId: string): void {
  const existing = refreshTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  refreshTimers.set(
    sessionId,
    setTimeout(() => {
      refreshTimers.delete(sessionId)
      void doRefreshMessages(sessionId)
    }, 100)
  )
}

function limitStreamText(value: string): string {
  return value.length <= MAX_STREAM_TEXT_LENGTH ? value : value.slice(0, MAX_STREAM_TEXT_LENGTH)
}

function refreshCurrentWorkspace(sessionId: string): void {
  const state = useThreadStore.getState()
  if (state.currentSessionId !== sessionId) return
  const session = state.sessions.find((item) => item.sessionId === sessionId)
  const workspacePath = session?.workspaceRoot || session?.cwd || state.activeFolderPath
  if (!workspacePath) return
  const key = normalizePathForComparison(workspacePath, window.api.platform)
  fileTreeCache.delete(key)
  void state.loadFileTree(workspacePath)
}

async function doRefreshMessages(sessionId: string): Promise<void> {
  const version = (messageRequestVersions.get(sessionId) ?? 0) + 1
  messageRequestVersions.set(sessionId, version)
  try {
    const raw = await window.api.sessionMessages({ sessionId })
    if (messageRequestVersions.get(sessionId) !== version) return
    if (!useThreadStore.getState().sessions.some((session) => session.sessionId === sessionId))
      return
    const fetched = raw
    upd((d) => {
      const existing = d.messagesMap[sessionId] ?? []
      const optimistic = existing.filter((m) => m.id && m.id.startsWith('optimistic-'))
      const toNum = (v: unknown): number =>
        typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : 0
      const lastFetchedTs = fetched.length > 0 ? toNum(fetched[fetched.length - 1].ts) : 0
      const pendingOptimistic = optimistic.filter((m) => toNum(m.ts) > lastFetchedTs + 500)
      d.messagesMap[sessionId] = [...fetched, ...pendingOptimistic]
      const ss = d.streamStates[sessionId]
      if (ss && !ss.isLoading) {
        if (!ss.error) d.streamStates[sessionId] = defaultStream()
      } else if (ss) {
        ss.text = ''
        ss.reasoning = ''
        ss.tools = []
        ss.error = undefined
      }
    })
  } catch (err: unknown) {
    Sentry.captureException(err)
  }
}

function handleAgentEvent(sessionId: string, ae: AgentEvent): void {
  if (
    !useThreadStore.getState().sessions.some((s) => s.sessionId === sessionId) &&
    !sessionId.startsWith('draft_')
  )
    return
  if (ae.type !== 'notice' && compactionActive.has(sessionId)) {
    upd((d) => {
      const comp = d.streamStates[sessionId]?.tools.find(
        (tl) => tl.toolCallId === 'compaction_notice'
      )
      if (comp && !comp.isFinished) comp.isFinished = true
    })
    compactionActive.delete(sessionId)
  }
  if (ae.type === 'iteration_start') {
    flushBuffersImmediately(sessionId)
    setStream(sessionId, { isLoading: true })
  } else if (ae.type === 'content_start') {
    if (ae.contentType === 'text') {
      const current =
        streamTextBuffers.get(sessionId) ??
        useThreadStore.getState().streamStates[sessionId]?.text ??
        ''
      streamTextBuffers.set(sessionId, limitStreamText(ae.accumulated || current + (ae.text ?? '')))
      scheduleBufferFlush(sessionId)
    } else if (ae.contentType === 'reasoning') {
      const current =
        streamReasoningBuffers.get(sessionId) ??
        useThreadStore.getState().streamStates[sessionId]?.reasoning ??
        ''
      streamReasoningBuffers.set(
        sessionId,
        limitStreamText(ae.accumulated || current + (ae.reasoning ?? ''))
      )
      scheduleBufferFlush(sessionId)
    } else if (ae.contentType === 'tool') {
      const fp = extractFilePath(ae.toolName ?? '', ae.input)
      const input = asRecord(ae.input)
      const currentSessionId = useThreadStore.getState().currentSessionId
      upd((d) => {
        if (!d.streamStates[sessionId]) d.streamStates[sessionId] = defaultStream()
        const toolCallId = ae.toolCallId
        const existing = d.streamStates[sessionId].tools.find(
          (tool) => tool.toolCallId === toolCallId
        )
        if (existing)
          Object.assign(existing, {
            name: ae.toolName || existing.name,
            input,
            filePath: fp,
            isFinished: false
          })
        else
          d.streamStates[sessionId].tools.push({
            toolCallId: ae.toolCallId || globalThis.crypto.randomUUID(),
            name: ae.toolName ?? '',
            input,
            filePath: fp,
            isFinished: false
          })
        d.streamStates[sessionId].isLoading = true
        const isBrowser = ae.toolName?.startsWith('playwright_')
        if (sessionId === currentSessionId && isBrowser) {
          d.showBrowser = true
          if (!d.artifactOpen) d.artifactOpen = true
        }
      })
    }
  } else if (ae.type === 'content_update') {
    upd((d) => {
      const tl = d.streamStates[sessionId]?.tools.find((t) => t.toolCallId === ae.toolCallId)
      if (tl) tl.output = asText(ae.update)
    })
  } else if (ae.type === 'content_end') {
    if (ae.contentType === 'text') {
      if (ae.text !== undefined) {
        streamTextBuffers.set(sessionId, limitStreamText(ae.text))
        scheduleBufferFlush(sessionId)
      }
    } else if (ae.contentType === 'reasoning') {
      if (ae.reasoning !== undefined) {
        streamReasoningBuffers.set(sessionId, limitStreamText(ae.reasoning))
        scheduleBufferFlush(sessionId)
      }
    } else if (ae.contentType === 'tool') {
      upd((d) => {
        const tl = d.streamStates[sessionId]?.tools.find((t) => t.toolCallId === ae.toolCallId)
        if (tl) {
          tl.isFinished = true
          tl.output = ae.error ? eventError(ae.error) : asText(ae.output)
          tl.isError = !!ae.error
        }
      })
      refreshMessages(sessionId)
      refreshCurrentWorkspace(sessionId)
    }
  } else if (ae.type === 'notice') {
    if (
      ae.reason === 'auto_compaction' ||
      ae.message === 'compacting' ||
      ae.message === 'auto-compacting'
    ) {
      compactionActive.add(sessionId)
      upd((d) => {
        if (!d.streamStates[sessionId]) d.streamStates[sessionId] = defaultStream()
        if (!d.streamStates[sessionId].tools.some((tl) => tl.toolCallId === 'compaction_notice')) {
          d.streamStates[sessionId].tools.push({
            toolCallId: 'compaction_notice',
            name: 'compact',
            input: {},
            isFinished: false
          })
        }
      })
    } else {
      setStream(sessionId, { statusNotice: ae.message })
    }
  } else if (ae.type === 'done') {
    flushBuffersImmediately(sessionId, { text: limitStreamText(ae.text ?? ''), isLoading: false })
    refreshMessages(sessionId)
    refreshCurrentWorkspace(sessionId)
  } else if (ae.type === 'error') {
    flushBuffersImmediately(sessionId, { isLoading: false, error: eventError(ae.error) })
    refreshCurrentWorkspace(sessionId)
  }
}

function handlePortEvent(sessionId: string, event: PortEvent): void {
  if (!event?.type) return
  if (event.type === 'agent_event') {
    if (event.payload?.event) handleAgentEvent(sessionId, event.payload.event)
  } else if (event.type === 'pending_prompts') {
    const prompts = event.payload?.prompts
    if (prompts) {
      useThreadStore.setState((s) => ({
        queuesMap: { ...s.queuesMap, [sessionId]: prompts }
      }))
    }
  } else if (event.type === 'ended') {
    flushBuffersImmediately(sessionId)
    compactionActive.delete(sessionId)
    useThreadStore.setState((s) => {
      const ss = s.streamStates[sessionId]
      if (!ss) return s
      const tools = ss.tools.map((tl) =>
        tl.toolCallId === 'compaction_notice' && !tl.isFinished ? { ...tl, isFinished: true } : tl
      )
      return {
        streamStates: { ...s.streamStates, [sessionId]: { ...ss, tools, isLoading: false } }
      }
    })
  } else if (event.type === 'error') {
    flushBuffersImmediately(sessionId)
    compactionActive.delete(sessionId)
    const err = event.payload?.error || 'Unknown error'
    useThreadStore.setState((s) => {
      const ss = s.streamStates[sessionId] ?? defaultStream()
      const tools = ss.tools.map((tl) =>
        tl.toolCallId === 'compaction_notice' && !tl.isFinished ? { ...tl, isFinished: true } : tl
      )
      return {
        streamStates: {
          ...s.streamStates,
          [sessionId]: { ...ss, tools, isLoading: false, error: err }
        }
      }
    })
  }
}

function setupSessionPort(sessionId: string): void {
  cleanupSessionPort(sessionId)
  const channel = new MessageChannel()
  portMap.set(sessionId, channel.port2)
  channel.port2.onmessage = (ev) => {
    if (portMap.get(sessionId) === channel.port2) handlePortEvent(sessionId, ev.data)
  }
  channel.port2.start()
  window.postMessage(
    { type: 'session:register-port-transfer', sessionId },
    window.location.origin,
    [channel.port1]
  )
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    useThreadStore.getState().reset()
  })
}
