import React, { useState } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, FolderPlus, Loader, Folder, FolderOpen, SlidersHorizontal } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, runningThreadsAtom } from '../store/agentStore'
import { useChat } from '../hooks/useChat'
import { format, isToday, isYesterday } from 'date-fns'

function useThreadListActions() {
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation } = useChat()
  return { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation }
}

const formatConversationDate = (dateStr: string): string => {
  try {
    const d = new Date(dateStr), diffMs = Date.now() - d.getTime()
    if (diffMs < 60000) return 'now'
    if (isToday(d)) return format(d, 'h:mm a')
    return isYesterday(d) ? 'Yesterday' : format(d, 'MMM d')
  } catch { return 'unknown' }
}

const ThreadList: React.FC = () => {
  const threads = useAtomValue(threadListAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const runningThreads = useAtomValue(runningThreadsAtom)
  const { selectThread, deleteThread, openWorkspace } = useThreadListActions()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    const confirmed = await window.api.invoke('dialog:confirm', { message: 'Delete this conversation?', detail: 'This will permanently remove the conversation and all its messages.', buttons: ['Cancel', 'Delete'], defaultId: 1, cancelId: 0 })
    if (confirmed === 1) await deleteThread(threadId)
  }

  const groups = React.useMemo(() => {
    const grouped: Record<string, { name: string; threads: any[] }> = {}
    threads.forEach((t) => {
      const path = t.workspacePath || ''
      const name = path ? (path.split(/[/\\]/).pop() ?? 'Workspace') : 'General'
      if (!grouped[path]) grouped[path] = { name, threads: [] }
      grouped[path].threads.push(t)
    })
    return Object.entries(grouped).sort((a, b) => {
      const latestA = Math.max(...a[1].threads.map(t => new Date(t.updatedAt || t.createdAt).getTime()))
      const latestB = Math.max(...b[1].threads.map(t => new Date(t.updatedAt || t.createdAt).getTime()))
      return latestB - latestA
    })
  }, [threads])

  return (
    <div className="sidebar-section thread-list-container">
      <div className="sidebar-section-header thread-list-header">
        <span>Projects</span>
        <div className="thread-list-header-actions">
          <SlidersHorizontal size={14} className="sidebar-section-header-action" />
          <span title="Open Project Folder" className="sidebar-section-header-action" onClick={() => openWorkspace()}><FolderPlus size={14} /></span>
        </div>
      </div>

      <div className="thread-list-group">
        {groups.length === 0 ? <div className="sidebar-empty-state">No conversations yet.</div> : groups.map(([path, group]) => {
          const isCollapsed = !!collapsedGroups[path]
          return (
            <div key={path} className="thread-list-group-wrapper">
              <div onClick={() => setCollapsedGroups(p => ({ ...p, [path]: !p[path] }))} className="thread-group-header">
                {isCollapsed ? (
                  <Folder size={16} strokeWidth={1.5} />
                ) : (
                  <FolderOpen size={16} strokeWidth={1.5} />
                )}
                <span className="thread-group-title">{group.name}</span>
              </div>
              {!isCollapsed && (
                <div className="thread-list-group">
                  {group.threads.map((thread) => {
                    const active = activeThreadId === thread.id
                    const isHovered = hoveredId === thread.id
                    return (
                      <div key={thread.id} className={`thread-item${active ? ' thread-item-active' : ''}`} onClick={() => selectThread(thread.id)} onMouseEnter={() => setHoveredId(thread.id)} onMouseLeave={() => setHoveredId(null)}>
                        <span className={`thread-item-title-text ${active ? 'thread-item-active-title' : ''}`}>{thread.title ?? 'New conversation'}</span>
                        <div className="thread-item-actions">
                          {runningThreads.has(thread.id) ? (
                            <Loader size={14} className="animate-spin" />
                          ) : isHovered ? (
                            <div className="sidebar-section-header-action thread-item-action-btn" onClick={(e) => handleDeleteThread(e, thread.id)} title="Delete conversation"><Trash2 size={12} /></div>
                          ) : (
                            <span className="thread-item-meta-time">{formatConversationDate(thread.createdAt)}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
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
