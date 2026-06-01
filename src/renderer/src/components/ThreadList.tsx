import React, { useState, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, ChevronDown, ChevronRight, X, Folder, FolderPlus, Loader2 } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, activeWorkspaceAtom, agentRunStateAtom } from '../store/agentStore'
import { useThreads } from '../hooks/useThreads'
import type { ThreadEntry } from '../../../preload/index.d'
import { formatDistanceToNow } from 'date-fns'

function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return 'unknown'
  }
}

const ThreadList: React.FC = () => {
  const threads = useAtomValue(threadListAtom)
  const activeThreadId = useAtomValue(activeThreadIdAtom)
  const activeWorkspace = useAtomValue(activeWorkspaceAtom)
  const agentRunState = useAtomValue(agentRunStateAtom)

  const { selectThread, deleteThread, openWorkspace, switchWorkspace, closeAndDeleteWorkspace } = useThreads()

  const [workspacePaths, setWorkspacePaths] = useState<string[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (activeWorkspace?.path) {
      setExpandedPaths((prev) => ({
        ...prev,
        [activeWorkspace.path]: prev[activeWorkspace.path] !== false
      }))
    }
  }, [activeWorkspace?.path])

  const loadWorkspacesList = useCallback(async () => {
    try {
      const paths = await window.api.getUniqueWorkspaces()
      setWorkspacePaths(paths ?? [])
    } catch (err) {
      console.error('[ThreadList] Failed to load workspaces list:', err)
    }
  }, [])

  useEffect(() => {
    loadWorkspacesList()
  }, [activeWorkspace?.path, loadWorkspacesList])

  const allWorkspacePaths = Array.from(
    new Set([
      ...(activeWorkspace?.path ? [activeWorkspace.path] : []),
      ...workspacePaths
    ])
  )

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    const confirmed = await window.api.showConfirmDialog({
      message: 'Delete this conversation?',
      detail: 'This will permanently remove the conversation and all its messages.',
      buttons: ['Cancel', 'Delete'],
      defaultId: 1,
      cancelId: 0
    })
    if (confirmed === 1) {
      await deleteThread(threadId)
    }
  }

  const handleCloseWorkspace = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    const name = path.split(/[/\\]/).pop() ?? 'Workspace'

    const confirmDelete = await window.api.showConfirmDialog({
      message: `Delete workspace data for "${name}"?`,
      detail: `This will permanently delete all related conversations, chat logs, and workspace artifacts from disk. Real codebase files inside the directory itself will NOT be touched.`,
      buttons: ['Cancel', 'Delete Data'],
      defaultId: 1,
      cancelId: 0
    })

    if (confirmDelete === 1) {
      const success = await closeAndDeleteWorkspace(path)
      if (success) {
        await loadWorkspacesList()
      }
    }
  }

  return (
    <div className="sidebar-section" style={{ padding: '12px 0', gap: '8px', display: 'flex', flexDirection: 'column' }}>
      {/* Projects Header with Add Folder Icon only */}
      <div
        className="sidebar-section-header"
        style={{
          padding: '0 12px 4px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-secondary)',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase'
        }}
      >
        <span>Projects</span>
        <span title="Add Project Folder" className="sidebar-section-header-action" onClick={() => openWorkspace()}>
          <FolderPlus size={14} />
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {allWorkspacePaths.length === 0 ? (
          <div style={{ padding: '0 12px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
            No projects opened yet.
          </div>
        ) : (
          allWorkspacePaths.map((path) => {
            const name = path.split(/[/\\]/).pop() ?? 'Workspace'
            const isActive = activeWorkspace?.path === path
            const isExpanded = !!expandedPaths[path]
            const workspaceThreads = threads.filter((t) => t.workspacePath === path)

            return (
              <div key={path} style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Project/Folder Row */}
                <div
                  className="workspace-node-row"
                  onClick={() => switchWorkspace(path)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                    <div
                      onClick={(e) => { e.stopPropagation(); toggleExpand(path) }}
                      style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: 2 }}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />
                      ) : (
                        <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                      )}
                    </div>

                    <Folder size={14} color="var(--text-secondary)" style={{ flexShrink: 0 }} />

                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={path}
                    >
                      {name}
                    </span>
                  </div>

                  <div className="workspace-node-actions" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <div
                      className="sidebar-section-header-action"
                      onClick={(e) => handleCloseWorkspace(e, path)}
                      title="Close project folder"
                      style={{ padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={13} />
                    </div>
                  </div>
                </div>

                {/* Sub-threads (indented list) */}
                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px 0 2px 24px' }}>
                    {workspaceThreads.length === 0 ? (
                      <span style={{ padding: '6px 12px', color: 'var(--text-dim)', fontSize: '12px', fontStyle: 'italic' }}>
                        No chats yet
                      </span>
                    ) : (
                      workspaceThreads.map((thread: ThreadEntry) => {
                        const isThreadActive = activeThreadId === thread.id
                        const isRunning = isThreadActive && agentRunState !== 'idle'

                        return (
                          <div
                            key={thread.id}
                            className="sidebar-tree-node"
                            style={{ cursor: 'pointer', padding: 0 }}
                          >
                            <div
                              className={`sidebar-tree-node-title${isThreadActive ? ' active' : ''}`}
                              onClick={() => selectThread(thread.id)}
                              style={{ justifyContent: 'space-between' }}
                            >
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  fontSize: '13px',
                                  color: isThreadActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  fontWeight: isThreadActive ? 500 : 400,
                                  flex: 1
                                }}
                              >
                                {thread.title ?? 'New conversation'}
                              </span>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
                                {isRunning ? (
                                  <Loader2
                                    size={12}
                                    style={{
                                      color: 'var(--accent-blue)',
                                      animation: 'spin 1s linear infinite'
                                    }}
                                  />
                                ) : (
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                                  </span>
                                )}
                                <div
                                  className="sidebar-section-header-action"
                                  onClick={(e) => handleDeleteThread(e, thread.id)}
                                  title="Delete conversation"
                                  style={{ display: 'flex', alignItems: 'center' }}
                                >
                                  <Trash2 size={12} />
                                </div>
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
