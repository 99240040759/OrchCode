import React from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  X,
  Globe,
  TerminalSquare,
  ClipboardList,
  BookOpen,
  FileText,
  ListTodo,
  PanelRightClose
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import type { EditorFile } from '../store/agentStore'

interface ArtifactPanelHeaderProps {
  panelMode: string
  openFiles: EditorFile[]
  hoveredTabPath: string | null
  setHoveredTabPath: (path: string | null) => void
  handleCloseFile: (file: EditorFile, e: React.MouseEvent) => void
  handleClose: () => void
  isMac: boolean
  isAgentArtifact: (name: string) => boolean
  getDisplayName: (name: string) => string
}

const getArtifactIcon = (name: string) => {
  if (name === 'implementation_plan.md') {
    return <ClipboardList size={15} style={{ flexShrink: 0, color: 'var(--accent-purple)' }} />
  }
  if (name === 'walkthrough.md') {
    return <BookOpen size={15} style={{ flexShrink: 0, color: 'var(--accent-green)' }} />
  }
  return <FileText size={15} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
}

export const ArtifactPanelHeader: React.FC<ArtifactPanelHeaderProps> = ({
  panelMode,
  openFiles,
  hoveredTabPath,
  setHoveredTabPath,
  handleCloseFile,
  handleClose,
  isMac,
  isAgentArtifact,
  getDisplayName
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '38px',
        backgroundColor: 'var(--bg-sidebar)',
        flexShrink: 0,
        paddingRight: isMac ? '12px' : '140px',
        overflowX: 'auto',
        scrollbarWidth: 'none'
      }}
    >
      <Tabs.List
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          overflowX: 'auto',
          scrollbarWidth: 'none'
        }}
      >
        <Tabs.Trigger value="overview" className="tab-trigger">
          <ListTodo
            size={14}
            style={{
              color: panelMode === 'overview' ? 'var(--accent-purple)' : 'var(--text-secondary)'
            }}
          />
          <span>Overview</span>
        </Tabs.Trigger>

        <Tabs.Trigger value="terminal" className="tab-trigger">
          <TerminalSquare
            size={14}
            style={{
              color: panelMode === 'terminal' ? 'var(--accent-green)' : 'var(--text-secondary)'
            }}
          />
          <span>Terminal</span>
        </Tabs.Trigger>

        <Tabs.Trigger value="browser" className="tab-trigger">
          <Globe
            size={14}
            style={{
              color: panelMode === 'browser' ? 'var(--accent-blue)' : 'var(--text-secondary)'
            }}
          />
          <span>Browser</span>
        </Tabs.Trigger>

        {openFiles.map((file) => {
          const isHovered = hoveredTabPath === file.path
          const isCloseVisible = isHovered
          return (
            <Tabs.Trigger
              key={file.path}
              value={file.path}
              className="tab-trigger"
              onMouseEnter={() => setHoveredTabPath(file.path)}
              onMouseLeave={() => setHoveredTabPath(null)}
            >
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  position: 'relative'
                }}
              >
                {isCloseVisible ? (
                  <span onClick={(e) => handleCloseFile(file, e)} className="tab-close-btn">
                    <X size={10} />
                  </span>
                ) : isAgentArtifact(file.name) ? (
                  getArtifactIcon(file.name)
                ) : (
                  <SymbolsFileIcon
                    fileName={file.name}
                    autoAssign={true}
                    width={16}
                    height={16}
                    style={{ flexShrink: 0 }}
                  />
                )}
              </div>

              <span>{getDisplayName(file.name)}</span>
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>

      <div onClick={handleClose} title="Collapse Panel" className="artifact-panel-close-btn">
        <PanelRightClose size={16} strokeWidth={1.5} color="var(--text-secondary)" />
      </div>
    </div>
  )
}

export default ArtifactPanelHeader
