import React, { useEffect, useState, useRef } from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { PanelRight, PanelRightClose, Package, FileCode, Info, ListTodo, CheckCircle2, Circle, Clock, ClipboardList, ClipboardCheck, BookOpen } from 'lucide-react'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
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



interface TaskItem {
  id: string
  text: string
  status: 'todo' | 'progress' | 'done'
  indent: number
}

export const RightSidebar: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [loading, setLoading] = useState(false)
  const artifacts = useAtomValue(artifactsAtom)
  const setArtifacts = useSetAtom(artifactsAtom)
  const convId = useAtomValue(conversationIdAtom)
  const filesChanged = useAtomValue(filesChangedAtom)

  // #21 fix: compute once at component scope
  const userFiles = filesChanged.filter(fc => !isAgentArtifact(fc.name))

  const activeConvId = convId
  const setArtifactPanelOpen = useSetAtom(isArtifactPanelOpenAtom)
  const setActiveEditorFile = useSetAtom(activeEditorFileAtom)
  const setArtifactPanelMode = useSetAtom(artifactPanelModeAtom)

  const [tasksList, setTasksList] = useState<TaskItem[]>([])
  const taskArtifact = artifacts.find((a) => a.name === 'task.md')

  const loadTasksTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!taskArtifact) {
      setTasksList([])
      return
    }

    // Debounce: rapid artifact-changed events during agent runs fire this effect
    // repeatedly — wait 500ms of silence before parsing the AST.
    if (loadTasksTimeoutRef.current) clearTimeout(loadTasksTimeoutRef.current)
    loadTasksTimeoutRef.current = setTimeout(async () => {
      try {
        const fileData = await window.api.readFile(taskArtifact.path, activeConvId)
        if (fileData && fileData.content) {
          const parsed: TaskItem[] = []
          const ast = remark().use(remarkGfm).parse(fileData.content)

          const walk = (node: any, depth = 0) => {
            if (node.type === 'listItem') {
              let isChecklist = false
              let status: 'todo' | 'progress' | 'done' = 'todo'
              let taskText = ''

              const firstChild = node.children?.[0]
              if (firstChild && firstChild.type === 'paragraph') {
                let fullText = ''
                const extractText = (n: any) => {
                  if (n.type === 'text') fullText += n.value
                  else if (n.children) n.children.forEach(extractText)
                }
                extractText(firstChild)

                if (node.checked !== undefined && node.checked !== null) {
                  isChecklist = true
                  status = node.checked ? 'done' : 'todo'
                  taskText = fullText.trim()
                } else {
                  const rawMatch = fullText.match(/^\[([/])\]\s*(.*)$/)
                  if (rawMatch) {
                    isChecklist = true
                    status = 'progress'
                    taskText = rawMatch[2].trim()
                  }
                }
              }

              if (node.position && node.position.start) {
                const lineIndex = node.position.start.line - 1
                const rawLines = fileData.content.split('\n')
                const rawLine = rawLines[lineIndex] || ''
                const match = rawLine.match(/^(\s*)[-*+]\s+\[([ xX/])\]\s*(.*)$/)
                if (match) {
                  isChecklist = true
                  const indent = match[1].length
                  const statusChar = match[2].toLowerCase()
                  taskText = match[3].trim()
                  status = statusChar === 'x' ? 'done' : statusChar === '/' ? 'progress' : 'todo'

                  parsed.push({
                    id: `task-${node.position.start.line}`,
                    text: taskText,
                    status,
                    indent: Math.floor(indent / 2)
                  })
                  isChecklist = false
                }
              }

              if (isChecklist && taskText) {
                parsed.push({
                  id: `task-${parsed.length}`,
                  text: taskText,
                  status,
                  indent: depth
                })
              }
            }

            if (node.children) {
              node.children.forEach((child: any) => {
                const nextDepth = node.type === 'list' ? depth + 1 : depth
                walk(child, nextDepth)
              })
            }
          }

          walk(ast, 0)
          setTasksList(parsed)
        } else {
          setTasksList([])
        }
      } catch (err) {
        console.error('[RightSidebar] Failed to load tasks:', err)
        setTasksList([])
      }
    }, 500)

    return () => {
      if (loadTasksTimeoutRef.current) clearTimeout(loadTasksTimeoutRef.current)
    }
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

  return (
    <aside
      className={`right-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: isExpanded ? 280 : 68,
        transition: 'width 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        willChange: 'width'
      }}
    >
      {!isExpanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 68 }}>
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
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 280 }}>
          <div className="sidebar-top-section" style={{ display: 'flex', flexDirection: 'column', padding: '12px 12px', gap: 12, flexShrink: 0 }}>
            <div className="sidebar-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-lg)', fontWeight: 500 }}>
                <Info size={18} strokeWidth={1.5} color="var(--text-secondary)" />
                <span style={{ color: '#e5e5e5' }}>Session Info</span>
              </div>
              <div
                className="sidebar-collapse-btn"
                onClick={() => setIsExpanded(false)}
                title="Collapse Sidebar"
                style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}
              >
                <PanelRightClose size={18} strokeWidth={1.5} color="var(--text-secondary)" />
              </div>
            </div>
          </div>

          <div className="sidebar-divider" />

          <div style={{ display: 'flex', flexDirection: 'column', padding: '12px 0', gap: 8, flex: 1, minHeight: 0 }}>
            <div className="sidebar-section" style={{ padding: '12px 0', gap: 8, display: 'flex', flexDirection: 'column', maxHeight: '180px' }}>
              <div className="sidebar-section-header" style={{ padding: '0 12px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
                <Package size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>Artifacts</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
                {loading ? (
                  <div style={{ padding: '0 12px' }}>
                    <Skeleton count={3} height={28} baseColor="#262626" highlightColor="#333333" style={{ marginBottom: 6, borderRadius: 4 }} />
                  </div>
                ) : artifacts.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', fontWeight: 500, padding: '0 12px' }}>
                    No artifacts created yet.
                  </div>
                ) : (
                  artifacts.map((art) => (
                    <div
                      key={art.name}
                      onClick={() => handleArtifactClick(art)}
                      className="right-sidebar-file-row"
                      style={{ margin: '0 8px', borderRadius: '6px' }}
                    >
                      {getArtifactIcon(art.name)}
                      <span className="right-sidebar-file-name" style={{ fontSize: 'var(--font-size-md)' }}>
                        {art.name === 'implementation_plan.md' ? 'Implementation Plan' : art.name === 'task.md' ? 'Task List' : art.name === 'walkthrough.md' ? 'Walkthrough' : art.name}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section" style={{ padding: '12px 0', gap: 8, display: 'flex', flexDirection: 'column', maxHeight: '180px' }}>
              <div className="sidebar-section-header" style={{ padding: '0 12px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
                <FileCode size={14} style={{ color: 'var(--text-secondary)' }} />
                <span>Files Changed</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, paddingRight: 4 }}>
                {userFiles.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', fontWeight: 500, padding: '0 12px' }}>
                    No workspace files modified.
                  </div>
                ) : (
                  userFiles.map((fc) => (
                    <div
                      key={fc.path}
                      onClick={() => handleFileChangeClick(fc)}
                      className="right-sidebar-file-row"
                      style={{ margin: '0 8px', borderRadius: '6px' }}
                    >
                      <FileIcon fileName={fc.name} size={13} />
                      <span className="right-sidebar-file-name" style={{ fontSize: 'var(--font-size-md)' }}>{fc.name}</span>
         
                      {fc.lineRange && (
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', flexShrink: 0 }}>
                          {fc.lineRange}
                        </span>
                      )}
         
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                        {fc.additions > 0 && (
                          <span style={{ color: 'var(--accent-green)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>
                            +{fc.additions}
                          </span>
                        )}
                        {fc.deletions > 0 && (
                          <span style={{ color: 'var(--accent-red)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', fontWeight: 700 }}>
                            -{fc.deletions}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section" style={{ padding: '12px 0', gap: 8, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="sidebar-section-header" style={{ padding: '0 12px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ListTodo size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Tasks & Progress</span>
                </div>
                {tasksList.length > 0 && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {tasksList.filter((t) => t.status === 'done').length}/{tasksList.length}
                  </span>
                )}
              </div>
         
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4, maxHeight: '200px' }}>
                {tasksList.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', fontWeight: 500, padding: '0 12px' }}>
                    No active tasks yet.
                  </div>
                ) : (
                  tasksList.map((task) => (
                    <div
                      key={task.id}
                      className="right-sidebar-file-row"
                      style={{
                        paddingLeft: `${task.indent * 4 + 10}px`,
                        margin: '0 8px',
                        paddingTop: '6px',
                        paddingBottom: '6px',
                        borderRadius: '6px',
                        fontSize: 'var(--font-size-md)',
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
                            fontSize: 'var(--font-size-md)',
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
          </div>
        </div>
      )}
    </aside>
  )
}

export default RightSidebar
