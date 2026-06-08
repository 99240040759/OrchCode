import React, { useMemo, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, ChevronDown, ChevronRight, X, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, activeWorkspaceAtom, agentRunStateAtom } from '../store/agentStore'
import { useChat } from '../hooks/useChat'
import { format, isToday, isYesterday } from 'date-fns'

const formatConversationDate = (dateStr: string): string => {
  try {
    const d = new Date(dateStr)
    if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`
    return isYesterday(d) ? `Yesterday at ${format(d, 'h:mm a')}` : format(d, 'MMM d, yyyy h:mm a')
  } catch { return 'unknown' }
}

const ThreadList: React.FC = () => {
  const threads = useAtomValue(threadListAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const agentRunState = useAtomValue(agentRunStateAtom)
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace } = useChat()
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})

  const allWorkspacePaths = useMemo(() => {
    const paths = threads.map(t => t.workspacePath || '')
    const set = new Set(paths)
    if (activeWorkspace?.path) set.add(activeWorkspace.path)
    return Array.from(set).sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))
  }, [threads, activeWorkspace?.path])

  const threadsByWorkspace = useMemo(() => {
    const map: Record<string, typeof threads> = {}
    for (const t of threads) {
      const p = t.workspacePath || ''
      if (!map[p]) map[p] = []
      map[p].push(t)
    }
    return map
  }, [threads])

  React.useEffect(() => {
    if (activeWorkspace?.path) setExpandedPaths(prev => ({ ...prev, [activeWorkspace.path]: prev[activeWorkspace.path] !== false }))
  }, [activeWorkspace?.path])

  const toggleExpand = useCallback((path: string) => setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] })), [])

  const handleDeleteThread = useCallback(async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    const confirmed = await window.api.invoke('dialog:confirm', { message: 'Delete this conversation?', detail: 'This will permanently remove the conversation and all its messages.', buttons: ['Cancel', 'Delete'], defaultId: 1, cancelId: 0 })
    if (confirmed === 1) await deleteThread(threadId)
  }, [deleteThread])

  const handleCloseWorkspace = useCallback(async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    const name = path.split(/[/\\]/).pop() ?? 'Workspace'
    const confirmed = await window.api.invoke('dialog:confirm', { message: `Delete workspace data for "${name}"?`, detail: `This will permanently delete all related conversations, chat logs, and workspace artifacts. Actual code files inside the folder will NOT be touched.`, buttons: ['Cancel', 'Delete Data'], defaultId: 1, cancelId: 0 })
    if (confirmed === 1) await closeAndDeleteWorkspace(path)
  }, [closeAndDeleteWorkspace])

  return (
    <div className="sidebar-section thread-list-container">
      <div className="sidebar-section-header thread-list-header">
        <span>Projects</span>
        <span title="Add Project Folder" className="sidebar-section-header-action" onClick={() => openWorkspace()}><FolderPlus size={14} /></span>
      </div>

      <div className="thread-list-group">
        {allWorkspacePaths.length === 0 ? <div className="empty-state-desc thread-list-header">No projects opened yet.</div> : allWorkspacePaths.map((path) => {
          const isActive = path === '' ? !activeWorkspace : activeWorkspace?.path === path, expanded = !!expandedPaths[path]
          return (
            <div key={path} className="thread-list-group">
              <div className="thread-group-header" onClick={() => toggleExpand(path)}>
                <div className="thread-group-actions">{expanded ? <ChevronDown size={14} className="text-secondary" /> : <ChevronRight size={14} className="text-secondary" />}</div>
                <Folder size={14} className="text-secondary" />
                <span className={`thread-group-title${isActive ? ' thread-item-active-title' : ''}`} title={path}>{path ? (path.split(/[/\\]/).pop() ?? 'Workspace') : 'General Chats'}</span>
                <div className="thread-group-actions">{path && <div className="sidebar-section-header-action" onClick={(e) => handleCloseWorkspace(e, path)} title="Close project"><X size={13} /></div>}</div>
              </div>
              {expanded && (
                <div className="thread-list-group">
                  {(() => {
                    const workspaceThreads = threadsByWorkspace[path] || []
                    return workspaceThreads.length === 0 ? <span className="empty-state-desc thread-list-header">No chats yet</span> :
                      workspaceThreads.map((thread) => {
                        const active = activeThreadId === thread.id
                        return (
                           <div key={thread.id} className={`thread-item${active ? ' thread-item-active' : ''}`} onClick={() => selectThread(thread.id)}>
                             <div className="thread-item-row">
                               <span className={`thread-item-title-text thread-item-title ${active ? 'thread-item-active-title' : ''}`}>{thread.title ?? 'New conversation'}</span>
                               {active && agentRunState !== 'idle' && <Loader2 size={12} className="running-indicator" />}
                             </div>
                             <div className="thread-item-meta">
                               <span className="thread-item-meta-time">{formatConversationDate(thread.updatedAt ?? thread.createdAt)}</span>
                               <div className="sidebar-section-header-action thread-item-action-btn" onClick={(e) => handleDeleteThread(e, thread.id)} title="Delete conversation"><Trash2 size={12} /></div>
                             </div>
                           </div>
                        )
                      })
                  })()}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ThreadList
