import React from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  X,
  Globe,
  TerminalSquare,
  ListTodo,
  PanelRightClose
} from 'lucide-react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import type { EditorFile } from '../store/agentStore'
import { isAgentArtifact, getArtifactIcon, getDisplayName } from '../lib/uiUtils'
import * as styles from './ArtifactPanel.css'

interface ArtifactPanelHeaderProps {
  panelMode: string
  openFiles: EditorFile[]
  hoveredTabPath: string | null
  setHoveredTabPath: (path: string | null) => void
  handleCloseFile: (file: EditorFile, e: React.MouseEvent) => void
  handleClose: () => void
  isMac: boolean
}

export const ArtifactPanelHeader: React.FC<ArtifactPanelHeaderProps> = ({
  panelMode,
  openFiles,
  hoveredTabPath,
  setHoveredTabPath,
  handleCloseFile,
  handleClose,
  isMac
}) => {
  return (
    <div
      className={`${styles.artifactPanelHeader} ${isMac ? styles.artifactPanelHeaderMac : styles.artifactPanelHeaderWin}`}
    >
      <Tabs.List
        className={styles.artifactPanelTabsList}
      >
        <Tabs.Trigger value="overview" className={styles.tabTrigger}>
          <ListTodo
            size={14}
            style={{
              color: panelMode === 'overview' ? 'var(--accent-purple)' : 'var(--text-secondary)'
            }}
          />
          <span>Overview</span>
        </Tabs.Trigger>

        <Tabs.Trigger value="terminal" className={styles.tabTrigger}>
          <TerminalSquare
            size={14}
            style={{
              color: panelMode === 'terminal' ? 'var(--accent-green)' : 'var(--text-secondary)'
            }}
          />
          <span>Terminal</span>
        </Tabs.Trigger>

        <Tabs.Trigger value="browser" className={styles.tabTrigger}>
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
          return (
            <Tabs.Trigger
              key={file.path}
              value={file.path}
              className={styles.tabTrigger}
              onMouseEnter={() => setHoveredTabPath(file.path)}
              onMouseLeave={() => setHoveredTabPath(null)}
            >
              <div className={styles.tabIconWrapper}>
                {isHovered ? (
                  <span onClick={(e) => handleCloseFile(file, e)} className={styles.tabCloseBtn}>
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

      <div onClick={handleClose} title="Collapse Panel" className={styles.artifactPanelCloseBtn}>
        <PanelRightClose size={16} strokeWidth={1.5} color="var(--text-secondary)" />
      </div>
    </div>
  )
}

export default ArtifactPanelHeader
