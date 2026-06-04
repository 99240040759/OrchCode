import React from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import OverviewPanel from './OverviewPanel'
import TerminalView from './TerminalView'
import BrowserView from './BrowserView'
import MediaPreview from './MediaPreview'
import MarkdownView from './MarkdownView'
import CodeEditorView from './CodeEditorView'
import type { EditorFile, FileChangeEntry } from '../store/agentStore'
import type { ArtifactEntry } from '../../../preload/index.d'
import type { TerminalViewHandle } from './TerminalView'
import { EmptyState } from './Primitives'
import * as styles from './ArtifactPanel.css'

interface ArtifactPanelContentProps {
  panelMode: string
  displayFile: EditorFile | null
  artifacts: ArtifactEntry[]
  userFiles: FileChangeEntry[]
  loading: boolean
  handleArtifactClick: (art: ArtifactEntry) => void
  handleFileChangeClick: (fc: FileChangeEntry) => void
  terminalRef: React.RefObject<TerminalViewHandle | null>
  activeWorkspace: { path: string } | null
  themeLoaded: boolean
  isDiffMode: boolean
  setIsDiffMode: (mode: boolean) => void
  originalContent: string | null
  handleDiffEditorMount: (editor: any) => void
  handleEditorMount: (editor: any) => void
  handleSearchClick: () => void
}

export const ArtifactPanelContent: React.FC<ArtifactPanelContentProps> = ({
  panelMode,
  displayFile,
  artifacts,
  userFiles,
  loading,
  handleArtifactClick,
  handleFileChangeClick,
  terminalRef,
  activeWorkspace,
  themeLoaded,
  isDiffMode,
  setIsDiffMode,
  originalContent,
  handleDiffEditorMount,
  handleEditorMount,
  handleSearchClick
}) => {
  const isMarkdown = displayFile?.name.endsWith('.md') ?? false

  return (
    <div className={styles.artifactPanelContent}>
      <Tabs.Content
        value="overview"
        className={styles.artifactPanelTabContent}
      >
        <OverviewPanel
          artifacts={artifacts}
          userFiles={userFiles}
          loading={loading}
          handleArtifactClick={handleArtifactClick}
          handleFileChangeClick={handleFileChangeClick}
        />
      </Tabs.Content>

      <Tabs.Content
        value="terminal"
        forceMount
        className={`${styles.artifactPanelTabContent} ${panelMode === 'terminal' ? styles.tabContentVisible : styles.tabContentHidden}`}
      >
        <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />
      </Tabs.Content>

      <Tabs.Content
        value="browser"
        forceMount
        className={`${styles.artifactPanelTabContent} ${panelMode === 'browser' ? styles.tabContentVisible : styles.tabContentHidden}`}
      >
        <BrowserView />
      </Tabs.Content>

      {/* Editor tab: forceMount to keep Monaco alive, manual visibility via CSS classes */}
      <Tabs.Content
        value="editor"
        forceMount
        className={`${styles.artifactPanelTabContent} ${panelMode === 'editor' ? styles.tabContentVisible : styles.tabContentHidden}`}
      >
        {!displayFile ? (
          <EmptyState
            icon="📂"
            title="No File Open"
            description="Select a file from the sidebar or ask the agent to edit or create a code file."
          />
        ) : displayFile.isBinary ? (
          <MediaPreview displayFile={displayFile} />
        ) : isMarkdown ? (
          <MarkdownView
            displayFile={displayFile}
            activeWorkspace={activeWorkspace}
          />
        ) : (
          <CodeEditorView
            displayFile={displayFile}
            activeWorkspace={activeWorkspace}
            themeLoaded={themeLoaded}
            isDiffMode={isDiffMode}
            setIsDiffMode={setIsDiffMode}
            originalContent={originalContent}
            handleDiffEditorMount={handleDiffEditorMount}
            handleEditorMount={handleEditorMount}
            handleSearchClick={handleSearchClick}
          />
        )}
      </Tabs.Content>
    </div>
  )
}

export default ArtifactPanelContent
