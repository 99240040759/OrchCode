import React, { useMemo, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, ChevronDown, ChevronRight, X, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, activeWorkspaceAtom, agentRunStateAtom } from '../store/agentStore'
import { useThreads } from '../hooks/useThreads'
import type { ThreadEntry } from '../../../preload/index.d'
import { format, isToday, isYesterday } from 'date-fns'

function formatConversationDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (isToday(date)) {
      return `Today at ${format(date, 'h:mm a')}`
    }
    if (isYesterday(date)) {
      return `Yesterday at ${format(date, 'h:mm a')}`
    }
    return format(date, 'MMM d, yyyy h:mm a')
  } catch {
    return 'unknown'
  }
}

const ThreadList: React.FC = () => {
  const threads = useAtomValue(threadListAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const agentRunState = useAtomValue(agentRunStateAtom)
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace } = useThreads()
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})

  const allWorkspacePaths = useMemo(() => {
    const fromThreads = threads.map((t) => t.workspacePath).filter((p): p is string => typeof p === 'string' && p.length > 0)
    const pathSet = new Set(fromThreads)
    if (activeWorkspace?.path) pathSet.add(activeWorkspace.path)
    return Array.from(pathSet)
  }, [threads, activeWorkspace?.path])

  React.useEffect(() => {
    if (activeWorkspace?.path) {
      setExpandedPaths((prev) => ({ ...prev, [activeWorkspace.path]: prev[activeWorkspace.path] !== false }))
    }
  }, [activeWorkspace?.path])

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }))
  }, [])

  const handleDeleteThread = useCallback(async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    const confirmed = await window.api.invoke('dialog:confirm', { message: 'Delete this conversation?', detail: 'This will permanently remove the conversation and all its messages.', buttons: ['Cancel', 'Delete'], defaultId: 1, cancelId: 0 }) as number
    if (confirmed === 1) await deleteThread(threadId)
  }, [deleteThread])

  const handleCloseWorkspace = useCallback(async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    const name = path.split(/[/\\]/).pop() ?? 'Workspace'
    const confirmDelete = await window.api.invoke('dialog:confirm', { message: `Delete workspace data for "${name}"?`, detail: `This will permanently delete all related conversations, chat logs, and workspace artifacts from disk. Real codebase files inside the directory itself will NOT be touched.`, buttons: ['Cancel', 'Delete Data'], defaultId: 1, cancelId: 0 }) as number
    if (confirmDelete === 1) await closeAndDeleteWorkspace(path)
  }, [closeAndDeleteWorkspace])

  return (
    <div className="sidebar-section thread-list-container">
      <div className="sidebar-section-header thread-list-header">
        <span>Projects</span>
        <span title="Add Project Folder" className="sidebar-section-header-action" onClick={() => openWorkspace()}>
          <FolderPlus size={14} />
        </span>
      </div>

      <div className="thread-list-group">
        {allWorkspacePaths.length === 0 ? (
          <div className="empty-state-desc thread-list-header">No projects opened yet.</div>
        ) : (
          allWorkspacePaths.map((path) => {
            const name = path.split(/[/\\]/).pop() ?? 'Workspace'
            const isActive = activeWorkspace?.path === path
            const isExpanded = !!expandedPaths[path]
            const workspaceThreads = threads.filter((t) => t.workspacePath === path)
            return (
              <div key={path} className="thread-list-group">
                <div className="thread-group-header" onClick={() => toggleExpand(path)}>
                  <div className="thread-group-actions">
                    {isExpanded ? <ChevronDown size={14} className="text-secondary" /> : <ChevronRight size={14} className="text-secondary" />}
                  </div>
                  <Folder size={14} className="text-secondary" />
                  <span className={`thread-group-title${isActive ? ' thread-item-active-title' : ''}`} title={path}>{name}</span>
                  <div className="thread-group-actions">
                    <div className="sidebar-section-header-action" onClick={(e) => handleCloseWorkspace(e, path)} title="Close project folder">
                      <X size={13} />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="thread-list-group">
                    {workspaceThreads.length === 0 ? (
                      <span className="empty-state-desc thread-list-header">No chats yet</span>
                    ) : (
                      workspaceThreads.map((thread: ThreadEntry) => {
                        const isThreadActive = activeThreadId === thread.id
                        const isRunning = isThreadActive && agentRunState !== 'idle'
                        return (
                          <div key={thread.id} className={`thread-item${isThreadActive ? ' thread-item-active' : ''}`} onClick={() => selectThread(thread.id)}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0 }}>
                              <span className={`thread-item-title${isThreadActive ? ' thread-item-active-title' : ''}`} style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                                {thread.title ?? 'New conversation'}
                              </span>
                              {isRunning && (
                                <Loader2 size={12} className="running-indicator" />
                              )}
                            </div>
                            <div className="thread-item-meta" style={{ marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minWidth: 0 }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                                {formatConversationDate(thread.updatedAt ?? thread.createdAt)}
                              </span>
                              <div className="sidebar-section-header-action" style={{ flexShrink: 0 }} onClick={(e) => handleDeleteThread(e, thread.id)} title="Delete conversation">
                                <Trash2 size={12} />
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default ThreadList
