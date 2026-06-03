import React from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import OverviewPanel, { getRelativeDirPath } from './OverviewPanel'
import TerminalView from './TerminalView'
import BrowserView from './BrowserView'
import MediaPreview from './MediaPreview'
import MarkdownView from './MarkdownView'
import CodeEditorView from './CodeEditorView'
import type { EditorFile, FileChangeEntry } from '../store/agentStore'
import type { ArtifactEntry } from '../../../preload/index.d'
import type { TerminalViewHandle } from './TerminalView'

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
  isAgentArtifact: (name: string) => boolean
  getDisplayName: (name: string) => string
}

const ClipboardListIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, color: 'var(--accent-purple)' }}
  >
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 14h6" />
    <path d="M9 18h6" />
    <path d="M9 10h6" />
  </svg>
)

const BookOpenIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, color: 'var(--accent-green)' }}
  >
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
)

const FileTextIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
  >
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </svg>
)

const getArtifactIcon = (name: string) => {
  if (name === 'implementation_plan.md') {
    return <ClipboardListIcon />
  }
  if (name === 'walkthrough.md') {
    return <BookOpenIcon />
  }
  return <FileTextIcon />
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
  handleSearchClick,
  isAgentArtifact,
  getDisplayName
}) => {
  const isMarkdown = displayFile?.name.endsWith('.md') ?? false

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <Tabs.Content
        value="overview"
        style={{ height: '100%', width: '100%', overflow: 'hidden' }}
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
        style={{
          height: '100%',
          width: '100%',
          overflow: 'hidden',
          display: panelMode === 'terminal' ? 'block' : 'none'
        }}
      >
        <TerminalView ref={terminalRef} workspacePath={activeWorkspace?.path} />
      </Tabs.Content>

      <Tabs.Content
        value="browser"
        forceMount
        style={{
          height: '100%',
          width: '100%',
          display: panelMode === 'browser' ? 'block' : 'none'
        }}
      >
        <BrowserView />
      </Tabs.Content>

      <div
        style={{
          display: panelMode === 'editor' ? 'block' : 'none',
          height: '100%',
          width: '100%'
        }}
      >
        {!displayFile ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '40px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              backgroundColor: 'var(--bg-app)'
            }}
          >
            <div
              style={{
                fontSize: '40px',
                marginBottom: '16px',
                filter: 'grayscale(0.3) contrast(1.2)'
              }}
            >
              📂
            </div>
            <h3
              style={{
                fontSize: 'var(--font-size-lg)',
                color: 'var(--text-primary)',
                fontWeight: 500,
                marginBottom: '6px',
                fontFamily: 'var(--font-display)'
              }}
            >
              No File Open
            </h3>
            <p
              style={{
                fontSize: 'var(--font-size-xs-plus)',
                maxWidth: '300px',
                lineHeight: 1.5,
                color: 'var(--text-secondary)',
                margin: 0
              }}
            >
              Select a file from the sidebar or ask the agent to edit or create a code file.
            </p>
          </div>
        ) : displayFile.isBinary ? (
          <MediaPreview displayFile={displayFile} />
        ) : isMarkdown ? (
          <MarkdownView
            displayFile={displayFile}
            activeWorkspace={activeWorkspace}
            isAgentArtifact={isAgentArtifact}
            getArtifactIcon={getArtifactIcon}
            getDisplayName={getDisplayName}
            getRelativeDirPath={getRelativeDirPath}
          />
        ) : (
          <CodeEditorView
            displayFile={displayFile}
            activeWorkspace={activeWorkspace}
            getDisplayName={getDisplayName}
            getRelativeDirPath={getRelativeDirPath}
            themeLoaded={themeLoaded}
            isDiffMode={isDiffMode}
            setIsDiffMode={setIsDiffMode}
            originalContent={originalContent}
            handleDiffEditorMount={handleDiffEditorMount}
            handleEditorMount={handleEditorMount}
            handleSearchClick={handleSearchClick}
          />
        )}
      </div>
    </div>
  )
}

export default ArtifactPanelContent
