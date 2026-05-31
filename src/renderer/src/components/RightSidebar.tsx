import React, { useEffect, useState } from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { PanelRight, PanelRightClose, Package, FileCode, Info, ListTodo, CheckCircle2, Circle, Clock, ClipboardList, ClipboardCheck, BookOpen } from 'lucide-react'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import {
  artifactsAtom,
  conversationIdAtom,
  isArtifactPanelOpenAtom,
  activeEditorFileAtom,
  filesChangedAtom,
  artifactPanelModeAtom,
  type FileChangeEntry
} from '../store/agentStore'
import { FileIcon } from './ToolCallBlock'
import type { ArtifactEntry } from '../../../preload/index.d'

const isAgentArtifact = (fileName: string) => {
  return fileName === 'implementation_plan.md' || fileName === 'task.md' || fileName === 'walkthrough.md'
}

const getArtifactIcon = (name: string) => {
  if (name === 'implementation_plan.md') {
    return <ClipboardList size={13} style={{ flexShrink: 0, color: 'var(--accent-purple)' }} />
  }
  if (name === 'task.md') {
    return <ClipboardCheck size={13} style={{ flexShrink: 0, color: 'var(--accent-blue)' }} />
  }
  if (name === 'walkthrough.md') {
    return <BookOpen size={13} style={{ flexShrink: 0, color: 'var(--accent-green)' }} />
  }
  return <FileCode size={13} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

interface TaskItem {
  id: string
  text: string
  status: 'todo' | 'progress' | 'done'
  indent: number
}

interface RightSidebarProps {
  conversationId?: string
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ conversationId }) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const artifacts = useAtomValue(artifactsAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const convId = useAtomValue(conversationIdAtom)
  const filesChanged = useAtomValue(filesChangedAtom)

  // #21 fix: compute once at component scope
  const userFiles = filesChanged.filter(fc => !isAgentArtifact(fc.name))

  const activeConvId = conversationId || convId
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  const [tasksList, setTasksList] = useState<TaskItem[]>([])
  const taskArtifact = artifacts.find((a) => a.name === 'task.md')

  useEffect(() => {
    const loadTasks = async () => {
      if (!taskArtifact) {
        setTasksList([])
        return
      }
      try {
        const fileData = await window.api.readFile(taskArtifact.path, activeConvId)
        if (fileData && fileData.content) {
          const parsed: TaskItem[] = []
          const lines = fileData.content.split('\n')
          lines.forEach((line: string, index: number) => {
            const match = line.match(/^(\s*)[-*+]\s+\[([ xX/])\]\s*(.*)$/)
            if (match) {
              const indent = match[1].length
              const statusChar = match[2].toLowerCase()
              const text = match[3].trim()
              if (text) {
                parsed.push({
                  id: `task-${index}`,
                  text,
                  status: statusChar === 'x' ? 'done' : statusChar === '/' ? 'progress' : 'todo',
                  indent
                })
              }
            }
          })
          setTasksList(parsed)
        } else {
          setTasksList([])
        }
      } catch (err) {
        console.error('[RightSidebar] Failed to load tasks:', err)
        setTasksList([])
      }
    }

    loadTasks()
  }, [taskArtifact?.path, taskArtifact?.modified, activeConvId])

  const handleArtifactClick = async (artifact: ArtifactEntry) => {
    try {
      const fileData = await window.api.readFile(artifact.path, activeConvId)
      if (fileData) {
        setActiveEditorFile(fileData)
        setArtifactPanelMode('editor')
        setArtifactPanelOpen(true)
      }
    } catch (err) {
      console.error('[RightSidebar] Failed to open artifact:', err)
    }
  }

  const handleFileChangeClick = async (fc: FileChangeEntry) => {
    try {
      const fileData = await window.api.readFile(fc.path, activeConvId)
      if (fileData) {
        setActiveEditorFile(fileData)
        setArtifactPanelMode('editor')
        setArtifactPanelOpen(true)
      }
    } catch (err) {
      console.error('[RightSidebar] Failed to open changed file:', err)
    }
  }

  useEffect(() => {
    if (!activeConvId) return
    let active = true
    setLoading(true)
    window.api
      .listArtifacts(activeConvId)
      .then((data) => {
        if (active) {
          setArtifacts(data ?? [])
          setLoading(false)
        }
      })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeConvId, setArtifacts])

  useEffect(() => {
    const unsub = window.api.onArtifactsChanged((data) => {
      setArtifacts(data ?? [])
    })
    return unsub
  }, [setArtifacts])

  if (!isExpanded) {
    return (
      <aside className="right-sidebar collapsed">
        <div className="collapsed-sidebar-top" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
          <div
            className="collapsed-icon-wrapper"
            onClick={() => setIsExpanded(true)}
            title="Expand Right Sidebar"
            style={{ padding: '14px 0', display: 'flex', justifyContent: 'center' }}
          >
            <PanelRight size={18} strokeWidth={1.5} color="var(--text-secondary)" />
          </div>
          <div className="sidebar-divider" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0', alignItems: 'center' }}>
            <div className="collapsed-icon-wrapper" title="Artifacts" style={{ padding: 0 }}>
              <Package size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            </div>
            <div className="collapsed-icon-wrapper" title="Files Changed" style={{ padding: 0 }}>
              <FileCode size={18} strokeWidth={1.5} color="var(--text-secondary)" />
            </div>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="right-sidebar expanded">
      <div
        className="sidebar-top-section"
        style={{ padding: '14px 16px', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 0 }}
      >
        <div className="sidebar-collapse-btn" onClick={() => setIsExpanded(false)} title="Collapse Right Sidebar">
          <PanelRightClose size={18} strokeWidth={1.5} color="var(--text-secondary)" />
        </div>
      </div>
      <div className="sidebar-divider" />

      <div className="sidebar-section" style={{ padding: '16px 16px 8px 16px', gap: 10 }}>
        <div className="sidebar-section-header" style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Artifacts</span>
            <Info size={14} color="var(--text-secondary)" />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '4px 0' }}>
            <Skeleton count={3} height={18} borderRadius={4} baseColor="#2c2c2e" highlightColor="#3a3a3e" style={{ marginBottom: 6 }} />
          </div>
        ) : artifacts.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
            No artifacts yet.
          </div>
        ) : (
          artifacts.map((artifact: ArtifactEntry) => (
            <div
              key={artifact.name}
              className="right-sidebar-file-row"
              title={artifact.path}
              onClick={() => handleArtifactClick(artifact)}
            >
              {getArtifactIcon(artifact.name)}
              <span className="right-sidebar-file-name">{artifact.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                {formatBytes(artifact.size)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section" style={{ padding: '16px 16px', gap: 10 }}>
        <div className="sidebar-section-header" style={{ padding: 0 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Files Changed</span>
          {userFiles.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              {userFiles.length}
            </span>
          )}
        </div>

        {userFiles.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
            No file changes yet.
          </div>
        ) : (
          userFiles.map((fc, idx) => (
            <div
              key={`${fc.path}-${idx}`}
              className="right-sidebar-file-row"
              title={fc.path}
              onClick={() => handleFileChangeClick(fc)}
            >
              <FileIcon fileName={fc.name} size={13} />
              <span className="right-sidebar-file-name">{fc.name}</span>

              {fc.lineRange && (
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10, flexShrink: 0 }}>
                  {fc.lineRange}
                </span>
              )}

              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {fc.additions > 0 && (
                  <span style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700 }}>
                    +{fc.additions}
                  </span>
                )}
                {fc.deletions > 0 && (
                  <span style={{ color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700 }}>
                    -{fc.deletions}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section" style={{ padding: '16px 16px', gap: 10, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="sidebar-section-header" style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ListTodo size={14} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Tasks & Progress</span>
          </div>
          {tasksList.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
              {tasksList.filter((t) => t.status === 'done').length}/{tasksList.length}
            </span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4, maxHeight: '200px' }}>
          {tasksList.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, padding: '0 6px' }}>
              No active tasks yet.
            </div>
          ) : (
            tasksList.map((task) => (
              <div
                key={task.id}
                className="right-sidebar-file-row"
                style={{
                  paddingLeft: `${task.indent * 4 + 6}px`,
                  opacity: task.status === 'done' ? 0.4 : 1,
                  cursor: 'default'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {task.status === 'done' ? (
                      <CheckCircle2 size={13} style={{ color: 'var(--accent-green)' }} />
                    ) : task.status === 'progress' ? (
                      <Clock size={13} style={{ color: 'var(--accent-orange)' }} />
                    ) : (
                      <Circle size={13} style={{ color: 'var(--text-secondary)' }} />
                    )}
                  </div>
                  <span
                    className="right-sidebar-file-name"
                    style={{
                      textDecoration: task.status === 'done' ? 'line-through' : 'none',
                      fontWeight: task.status === 'progress' ? 600 : undefined
                    }}
                  >
                    {task.text}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  )
}

export default RightSidebar
