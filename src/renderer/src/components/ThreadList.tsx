import React, { useMemo, useState, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { Trash2, ChevronDown, ChevronRight, X, Folder, FolderPlus, Loader2 } from 'lucide-react'
import {
  threadListAtom,
  activeThreadIdAtom,
  activeWorkspaceAtom,
  agentRunStateAtom
} from '../store/agentStore'
import { useThreads } from '../hooks/useThreads'
import type { ThreadEntry } from '../../../preload/index.d'
import { formatDistanceToNow } from 'date-fns'
import * as styles from './sidebar.css'

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

  const { selectThread, deleteThread, openWorkspace, closeAndDeleteWorkspace } = useThreads()

  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({})

  // Derive unique workspace paths directly from thread list — no API call needed
  const allWorkspacePaths = useMemo(() => {
    const fromThreads = threads
      .map((t) => t.workspacePath)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)

    const pathSet = new Set(fromThreads)
    // Always include active workspace even if it has no threads yet
    if (activeWorkspace?.path) pathSet.add(activeWorkspace.path)

    return Array.from(pathSet)
  }, [threads, activeWorkspace?.path])

  React.useEffect(() => {
    if (activeWorkspace?.path) {
      setExpandedPaths((prev) => ({
        ...prev,
        [activeWorkspace.path]: prev[activeWorkspace.path] !== false
      }))
    }
  }, [activeWorkspace?.path])

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }))
  }, [])

  const handleDeleteThread = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation()
      const confirmed = await window.dialogBridge.showConfirmDialog({
        message: 'Delete this conversation?',
        detail: 'This will permanently remove the conversation and all its messages.',
        buttons: ['Cancel', 'Delete'],
        defaultId: 1,
        cancelId: 0
      })
      if (confirmed === 1) {
        await deleteThread(threadId)
      }
    },
    [deleteThread]
  )

  const handleCloseWorkspace = useCallback(
    async (e: React.MouseEvent, path: string) => {
      e.stopPropagation()
      const name = path.split(/[/\\]/).pop() ?? 'Workspace'

      const confirmDelete = await window.dialogBridge.showConfirmDialog({
        message: `Delete workspace data for "${name}"?`,
        detail: `This will permanently delete all related conversations, chat logs, and workspace artifacts from disk. Real codebase files inside the directory itself will NOT be touched.`,
        buttons: ['Cancel', 'Delete Data'],
        defaultId: 1,
        cancelId: 0
      })

      if (confirmDelete === 1) {
        await closeAndDeleteWorkspace(path)
      }
    },
    [closeAndDeleteWorkspace]
  )

  return (
    <div className={`${styles.sidebarSection} ${styles.threadListContainer}`}>
      <div className={`${styles.sidebarSectionHeader} ${styles.threadListHeader}`}>
        <span>Projects</span>
        <span
          title="Add Project Folder"
          className={styles.sidebarSectionHeaderAction}
          onClick={() => openWorkspace()}
        >
          <FolderPlus size={14} />
        </span>
      </div>

      <div className={styles.threadListGroup}>
        {allWorkspacePaths.length === 0 ? (
          <div className={`${styles.emptyStateDesc} ${styles.threadListHeader}`}>
            No projects opened yet.
          </div>
        ) : (
          allWorkspacePaths.map((path) => {
            const name = path.split(/[/\\]/).pop() ?? 'Workspace'
            const isActive = activeWorkspace?.path === path
            const isExpanded = !!expandedPaths[path]
            const workspaceThreads = threads.filter((t) => t.workspacePath === path)

            return (
              <div key={path} className={styles.threadListGroup}>
                <div className={styles.threadGroupHeader} onClick={() => toggleExpand(path)}>
                  <div className={styles.threadGroupActions}>
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-secondary" />
                    ) : (
                      <ChevronRight size={14} className="text-secondary" />
                    )}
                  </div>

                  <Folder size={14} className="text-secondary" />

                  <span
                    className={`${styles.threadGroupTitle} ${isActive ? styles.threadItemActiveTitle : ''}`}
                    title={path}
                  >
                    {name}
                  </span>

                  <div className={styles.threadGroupActions}>
                    <div
                      className={styles.sidebarSectionHeaderAction}
                      onClick={(e) => handleCloseWorkspace(e, path)}
                      title="Close project folder"
                    >
                      <X size={13} />
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className={styles.threadListGroup}>
                    {workspaceThreads.length === 0 ? (
                      <span className={`${styles.emptyStateDesc} ${styles.threadListHeader}`}>
                        No chats yet
                      </span>
                    ) : (
                      workspaceThreads.map((thread: ThreadEntry) => {
                        const isThreadActive = activeThreadId === thread.id
                        const isRunning = isThreadActive && agentRunState !== 'idle'

                        return (
                          <div
                            key={thread.id}
                            className={`${styles.threadItem} ${isThreadActive ? styles.threadItemActive : ''}`}
                            onClick={() => selectThread(thread.id)}
                          >
                            <span className={`${styles.threadItemTitle} ${isThreadActive ? styles.threadItemActiveTitle : ''}`}>
                              {thread.title ?? 'New conversation'}
                            </span>
                            
                            <div className={styles.threadItemMeta}>
                              {isRunning ? (
                                <Loader2 size={12} className={styles.runningIndicator} />
                              ) : (
                                <span>{formatRelativeTime(thread.updatedAt ?? thread.createdAt)}</span>
                              )}
                              
                              <div
                                className={styles.sidebarSectionHeaderAction}
                                onClick={(e) => handleDeleteThread(e, thread.id)}
                                title="Delete conversation"
                              >
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
