import React, { useState, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Plus, Trash2, ChevronDown, ChevronRight, X } from 'lucide-react'
import { threadListAtom, activeThreadIdAtom, activeWorkspaceAtom } from '../store/agentStore'
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

  const { selectThread, newConversation, deleteThread, openWorkspace, switchWorkspace, closeAndDeleteWorkspace } = useThreads()

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

  const handleNewChatInWorkspace = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    await switchWorkspace(path)
    await newConversation()
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
    <div className="sidebar-section" style={{ padding: '12px 0', gap: 8 }}>
      <div className="sidebar-section-header" style={{ padding: '0 12px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        <span>Workspaces</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {allWorkspacePaths.length === 0 ? (
          <div style={{ padding: '0 16px', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
            No workspaces opened yet.
          </div>
        ) : (
          allWorkspacePaths.map((path) => {
            const name = path.split(/[/\\]/).pop() ?? 'Workspace'
            const isActive = activeWorkspace?.path === path
            const isExpanded = !!expandedPaths[path]
            const workspaceThreads = threads.filter((t) => t.workspacePath === path)

            return (
              <div key={path} style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                  onClick={() => switchWorkspace(path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    margin: '0 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
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
                    <span
                      style={{
                        fontSize: 'var(--font-size-md)',
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div
                      className="sidebar-section-header-action"
                      onClick={(e) => handleCloseWorkspace(e, path)}
                      title="Close workspace and delete data"
                      style={{ padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={14} />
                    </div>
                    <div
                      className="sidebar-section-header-action"
                      onClick={(e) => handleNewChatInWorkspace(e, path)}
                      title="Start chat in workspace"
                      style={{ padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Plus size={14} strokeWidth={2} />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 4px 20px' }}>
                    {workspaceThreads.length === 0 ? (
                      <span style={{ padding: '6px 12px 6px 12px', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', fontStyle: 'italic' }}>
                        No chats yet
                      </span>
                    ) : (
                      workspaceThreads.map((thread: ThreadEntry) => (
                        <div
                          key={thread.id}
                          className="sidebar-tree-node"
                          style={{ cursor: 'pointer', padding: 0 }}
                        >
                          <div
                            className="sidebar-tree-node-title"
                            onClick={() => selectThread(thread.id)}
                            style={{
                              background: activeThreadId === thread.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                              borderRadius: 6,
                              padding: '6px 10px',
                              margin: '0',
                              justifyContent: 'space-between',
                              display: 'flex',
                              alignItems: 'center',
                              width: '100%',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: 'var(--font-size-md)',
                                color: activeThreadId === thread.id ? 'var(--text-primary)' : '#b0b0b5',
                                fontWeight: activeThreadId === thread.id ? 500 : 400,
                                flex: 1
                              }}
                            >
                              {thread.title ?? 'New conversation'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
                              </span>
                              <div
                                className="sidebar-section-header-action"
                                onClick={(e) => { e.stopPropagation(); deleteThread(thread.id) }}
                                title="Delete conversation"
                              >
                                <Trash2 size={12} />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div
        className="sidebar-action-text"
        onClick={() => openWorkspace()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          margin: '0 8px',
          borderRadius: '6px',
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          fontSize: 'var(--font-size-md)',
          fontWeight: 500,
          transition: 'all 0.2s ease',
          marginTop: 4
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)'
          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)'
          e.currentTarget.style.backgroundColor = 'transparent'
        }}
      >
        <Plus size={16} strokeWidth={2} />
        <span>Open Workspace</span>
      </div>
    </div>
  )
}

export default ThreadList
