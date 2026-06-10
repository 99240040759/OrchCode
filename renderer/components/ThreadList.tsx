import React, { useState } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, FolderPlus, Loader } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, runningThreadsAtom } from '../store/agentStore'
import { useChat } from '../hooks/useChat'
import { format, isToday, isYesterday } from 'date-fns'

function useThreadListActions() {
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation } = useChat()
  return { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation }
}

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
  const runningThreads = useAtomValue(runningThreadsAtom)
  const { selectThread, deleteThread, openWorkspace } = useThreadListActions()
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    const confirmed = await window.api.invoke('dialog:confirm', { message: 'Delete this conversation?', detail: 'This will permanently remove the conversation and all its messages.', buttons: ['Cancel', 'Delete'], defaultId: 1, cancelId: 0 })
    if (confirmed === 1) await deleteThread(threadId)
  }

  return (
    <div className="sidebar-section thread-list-container">
      <div className="sidebar-section-header thread-list-header">
        <span>Conversations</span>
        <span title="Open Project Folder" className="sidebar-section-header-action" onClick={() => openWorkspace()}><FolderPlus size={14} /></span>
      </div>

      <div className="thread-list-group">
        {threads.length === 0 ? <div className="sidebar-empty-state">No conversations yet.</div> : threads.map((thread) => {
          const active = activeThreadId === thread.id
          const wsName = thread.workspacePath ? (thread.workspacePath.split(/[/\\]/).pop() ?? 'Workspace') : null
          const isHovered = hoveredId === thread.id
          return (
            <div key={thread.id} className={`thread-item${active ? ' thread-item-active' : ''}`} onClick={() => selectThread(thread.id)} onMouseEnter={() => setHoveredId(thread.id)} onMouseLeave={() => setHoveredId(null)} style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div className="thread-item-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span className={`thread-item-title-text thread-item-title ${active ? 'thread-item-active-title' : ''}`} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{thread.title ?? 'New conversation'}</span>
                {runningThreads.has(thread.id) && <Loader size={14} className="animate-spin running-indicator" style={{ marginLeft: '6px' }} />}
              </div>
              <div className="thread-item-meta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', marginTop: '4px', height: '14px', width: '100%' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                  {wsName || ''}
                </span>
                <span style={{ flexShrink: 0, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {isHovered ? (
                    <div className="sidebar-section-header-action thread-item-action-btn" onClick={(e) => handleDeleteThread(e, thread.id)} title="Delete conversation" style={{ cursor: 'pointer', opacity: 0.8, display: 'inline-flex' }}><Trash2 size={12} /></div>
                  ) : (
                    <span className="thread-item-meta-time" style={{ color: 'var(--text-muted)' }}>{formatConversationDate(thread.createdAt)}</span>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ThreadList
