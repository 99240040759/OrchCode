import React, { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useAtomValue } from 'jotai'
import { Trash2, FolderPlus, Loader, Folder, FolderOpen, SlidersHorizontal, MoreVertical } from 'lucide-react'
import Dropdown, { DropdownItem } from './Dropdown'
import { threadListAtom, activeThreadIdAtom, runningThreadsAtom } from '../store/agentStore'
import { useChat } from '../hooks/useChat'
import { threadService } from '../services/services'
import Dialog from './Dialog'
import Tooltip from './Tooltip'

function useThreadListActions() {
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation, loadThreads } = useChat()
  return { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, newConversation, loadThreads }
}

const formatConversationDate = (dateStr: string): string => {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    return diff < 1 ? 'now' : diff < 60 ? `${diff}m` : diff < 1440 ? `${Math.floor(diff / 60)}h` : diff < 10080 ? `${Math.floor(diff / 1440)}d` : diff < 40320 ? `${Math.floor(diff / 10080)}w` : diff < 525600 ? `${Math.floor(diff / 43200)}mo` : `${Math.floor(diff / 525600)}y`
  } catch { return 'unknown' }
}

const ThreadList: React.FC = () => {
  const threads = useAtomValue(threadListAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const runningThreads = useAtomValue(runningThreadsAtom)
  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace, loadThreads } = useThreadListActions()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [sortBy, setSortBy] = useState<'activity' | 'alphabetical'>('activity')
  const [threadToDelete, setThreadToDelete] = useState<string | null>(null)
  const [threadToRename, setThreadToRename] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  useHotkeys('ctrl+shift+s, cmd+shift+s', (e) => { e.preventDefault(); setSortBy(s => s === 'activity' ? 'alphabetical' : 'activity') }, { enableOnFormTags: true })
  useHotkeys('f2', (e) => { e.preventDefault(); if (activeThreadId) { const active = threads.find(t => t.id === activeThreadId); if (active) { setThreadToRename(activeThreadId); setRenameTitle(active.title || '') } } }, { enableOnFormTags: true }, [activeThreadId, threads])
  useHotkeys('ctrl+shift+d, cmd+shift+d', (e) => { e.preventDefault(); if (activeThreadId) setThreadToDelete(activeThreadId) }, { enableOnFormTags: true }, [activeThreadId])

  const groups = React.useMemo(() => {
    const grouped: Record<string, { name: string; threads: any[] }> = {}
    threads.forEach((t) => {
      const path = t.workspacePath || ''
      const name = path ? (path.split(/[/\\]/).pop() ?? 'Workspace') : 'General'
      if (!grouped[path]) grouped[path] = { name, threads: [] }
      grouped[path].threads.push(t)
    })
    Object.values(grouped).forEach(g => {
      g.threads.sort((a, b) => {
        if (sortBy === 'alphabetical') return (a.title || 'New Chat').localeCompare(b.title || 'New Chat')
        const tA = new Date(a.updatedAt || a.createdAt).getTime(), tB = new Date(b.updatedAt || b.createdAt).getTime()
        return tB - tA
      })
    })
    const entries = Object.entries(grouped)
    if (sortBy === 'alphabetical') {
      return entries.sort((a, b) => {
        if (!a[0]) return 1
        if (!b[0]) return -1
        return a[1].name.localeCompare(b[1].name)
      })
    }
    return entries.sort((a, b) => {
      const latestA = Math.max(...a[1].threads.map(t => new Date(t.updatedAt || t.createdAt).getTime()))
      const latestB = Math.max(...b[1].threads.map(t => new Date(t.updatedAt || t.createdAt).getTime()))
      return latestB - latestA
    })
  }, [threads, sortBy])

  return (
    <div className="sidebar-section thread-list-container">
      <div className="sidebar-section-header thread-list-header">
        <span>Projects</span>
        <div className="thread-list-header-actions">
          <Dropdown align="end" sideOffset={6} className="dropdown-menu-content-sm" trigger={
            <Tooltip content="Sort Projects (Ctrl+Shift+S)"><button type="button" className="sidebar-section-header-action"><SlidersHorizontal size={14} /></button></Tooltip>
          }>
            <DropdownItem onSelect={() => setSortBy('activity')} className={`app-dropdown-item${sortBy === 'activity' ? ' selected' : ''}`}>Sort by Activity</DropdownItem>
            <DropdownItem onSelect={() => setSortBy('alphabetical')} className={`app-dropdown-item${sortBy === 'alphabetical' ? ' selected' : ''}`}>Sort Alphabetically</DropdownItem>
          </Dropdown>
          <Tooltip content="Open Project Folder (Ctrl+O)">
            <button type="button" className="sidebar-section-header-action" onClick={() => openWorkspace()}><FolderPlus size={14} /></button>
          </Tooltip>
        </div>
      </div>

      <div className="thread-list-group">
        {groups.length === 0 ? <div className="sidebar-empty-state">No conversations yet.</div> : groups.map(([path, group]) => {
          const isCollapsed = !!collapsedGroups[path]
          return (
            <div key={path} className="thread-list-group-wrapper">
              <div
                onClick={() => setCollapsedGroups(p => ({ ...p, [path]: !p[path] }))}
                className="thread-group-header"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsedGroups(p => ({ ...p, [path]: !p[path] })) } }}
              >
                {isCollapsed ? <Folder size={16} strokeWidth={1.5} /> : <FolderOpen size={16} strokeWidth={1.5} />}
                <span className="thread-group-title">{group.name}</span>
                <div className="thread-group-actions">
                  {path !== '' && (
                    <Tooltip content="Delete project workspace">
                      <button
                        type="button"
                        className="sidebar-section-header-action thread-item-action-btn thread-group-delete-btn"
                        onClick={(e) => { e.stopPropagation(); setWorkspaceToDelete(path) }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
              {!isCollapsed && (
                <div className="thread-list-group">
                  {group.threads.map((thread) => {
                    const active = activeThreadId === thread.id
                    return (
                      <div
                        key={thread.id}
                        className={`thread-item${active ? ' thread-item-active' : ''}`}
                        onClick={() => selectThread(thread.id)}
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectThread(thread.id) } }}
                      >
                        <span className={`thread-item-title-text ${active ? 'thread-item-active-title' : ''}`}>{thread.title ?? 'New conversation'}</span>
                        <div className="thread-item-actions">
                          {runningThreads.has(thread.id) ? (
                            <Loader size={14} className="animate-spin" />
                          ) : (
                            <>
                              <span className="thread-item-meta-time">{formatConversationDate(thread.updatedAt || thread.createdAt)}</span>
                              <Dropdown align="end" sideOffset={4} className="dropdown-menu-content-sm" trigger={
                                <Tooltip content="Thread Actions (Rename: F2, Delete: Ctrl+Shift+D)">
                                  <button type="button" className="sidebar-section-header-action thread-item-action-btn thread-item-menu-btn" onClick={(e) => e.stopPropagation()}><MoreVertical size={12} /></button>
                                </Tooltip>
                              }>
                                <Tooltip content="Rename this conversation (F2)"><DropdownItem onSelect={(e) => { e.preventDefault(); setThreadToRename(thread.id); setRenameTitle(thread.title || '') }} className="app-dropdown-item">Rename</DropdownItem></Tooltip>
                                <Tooltip content="Delete this conversation (Ctrl+Shift+D)"><DropdownItem onSelect={(e) => { e.preventDefault(); setThreadToDelete(thread.id) }} className="app-dropdown-item text-accent-red">Delete</DropdownItem></Tooltip>
                              </Dropdown>
                            </>
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

      <Dialog isOpen={threadToRename !== null} onClose={() => !isRenaming && setThreadToRename(null)} title="Rename Conversation">
        <form onSubmit={async (e) => { e.preventDefault(); if (threadToRename && renameTitle.trim() && !isRenaming) { setIsRenaming(true); try { await threadService.updateThreadTitle(threadToRename, renameTitle.trim()); await loadThreads(); setThreadToRename(null) } catch (err) { console.error(err) } finally { setIsRenaming(false) } } }}>
          <div>Enter a new name for this conversation:</div>
          <input type="text" className="dialog-input" value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Conversation name" autoFocus disabled={isRenaming} />
          <div className="dialog-actions">
            <button type="button" className="dialog-btn dialog-btn-secondary" onClick={() => setThreadToRename(null)} disabled={isRenaming}>Cancel</button>
            <button type="submit" className="dialog-btn dialog-btn-primary" disabled={isRenaming}>{isRenaming ? <Loader size={14} className="animate-spin" /> : 'Rename'}</button>
          </div>
        </form>
      </Dialog>

      <Dialog isOpen={threadToDelete !== null} onClose={() => !isDeleting && setThreadToDelete(null)} title="Delete Conversation">
        <form onSubmit={async (e) => { e.preventDefault(); if (threadToDelete && !isDeleting) { setIsDeleting(true); try { await deleteThread(threadToDelete); setThreadToDelete(null) } catch (err) { console.error(err) } finally { setIsDeleting(false) } } }}>
          <div>Are you sure you want to permanently delete this conversation and all its messages?</div>
          <div className="dialog-actions" style={{ flexDirection: 'row-reverse' }}>
            <button type="submit" className="dialog-btn dialog-btn-danger" autoFocus disabled={isDeleting}>{isDeleting ? <Loader size={14} className="animate-spin" /> : 'Delete'}</button>
            <button type="button" className="dialog-btn dialog-btn-secondary" onClick={() => setThreadToDelete(null)} disabled={isDeleting}>Cancel</button>
          </div>
        </form>
      </Dialog>

      <Dialog isOpen={workspaceToDelete !== null} onClose={() => !isDeletingWorkspace && setWorkspaceToDelete(null)} title="Delete Workspace Project">
        <form onSubmit={async (e) => { e.preventDefault(); if (workspaceToDelete && !isDeletingWorkspace) { setIsDeletingWorkspace(true); try { await closeAndDeleteWorkspace(workspaceToDelete); setWorkspaceToDelete(null) } catch (err) { console.error(err) } finally { setIsDeletingWorkspace(false) } } }}>
          <div>Are you sure you want to delete this workspace project? This will permanently close the workspace and delete all of its related conversation threads.</div>
          <div className="dialog-actions" style={{ flexDirection: 'row-reverse' }}>
            <button type="submit" className="dialog-btn dialog-btn-danger" autoFocus disabled={isDeletingWorkspace}>{isDeletingWorkspace ? <Loader size={14} className="animate-spin" /> : 'Delete Project'}</button>
            <button type="button" className="dialog-btn dialog-btn-secondary" onClick={() => setWorkspaceToDelete(null)} disabled={isDeletingWorkspace}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

export default ThreadList
