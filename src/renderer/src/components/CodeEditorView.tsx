import React from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { FileDiff, Search, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { getDisplayName, getRelativeDirPath } from '../lib/uiUtils'
import * as styles from './CodeEditorView.css'

interface CodeEditorViewProps {
  displayFile: {
    name: string
    path: string
    content?: string
    language?: string
    isBinary?: boolean
  }
  activeWorkspace: { path: string } | null
  themeLoaded: boolean
  isDiffMode: boolean
  setIsDiffMode: (val: boolean) => void
  originalContent: string | null
  handleDiffEditorMount: (editor: any) => void
  handleEditorMount: (editor: any) => void
  handleSearchClick: () => void
}

export const CodeEditorView: React.FC<CodeEditorViewProps> = ({
  displayFile,
  activeWorkspace,
  themeLoaded,
  isDiffMode,
  setIsDiffMode,
  originalContent,
  handleDiffEditorMount,
  handleEditorMount,
  handleSearchClick
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.fileInfoContainer}>
          <SymbolsFileIcon
            fileName={displayFile.name}
            autoAssign={true}
            width={16}
            height={16}
            className={styles.fileIcon}
          />
          <span className={styles.fileName}>
            {getDisplayName(displayFile.name)}
          </span>
          <span className={styles.fileDir}>
            {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
          </span>
        </div>

        <div className={styles.toolbarGroup}>
          <div
            title={isDiffMode ? 'Show Code Editor' : 'Show File Diff (vs git HEAD)'}
            onClick={() => setIsDiffMode(!isDiffMode)}
            className={
              isDiffMode
                ? `${styles.editorToolbarAction} ${styles.editorToolbarActionActive}`
                : styles.editorToolbarAction
            }
          >
            <FileDiff size={13} />
          </div>
          <div
            title="Find in file (native)"
            onClick={handleSearchClick}
            className={styles.editorToolbarAction}
          >
            <Search size={13} />
          </div>
          <div
            title="Copy file content"
            onClick={() => {
              navigator.clipboard.writeText(displayFile.content ?? '')
              toast.success('File content copied!')
            }}
            className={styles.editorToolbarAction}
          >
            <Copy size={13} />
          </div>
        </div>
      </div>
      <div className={styles.editorContainer}>
        {themeLoaded ? (
          isDiffMode ? (
            originalContent === null ? (
              <div className={styles.loadingContainer}>
                <div className={styles.loadingSpinner} />
                Loading diff...
              </div>
            ) : (
              <DiffEditor
                height="100%"
                language={displayFile.language}
                theme="orch-dark"
                original={originalContent ?? ''}
                modified={displayFile.content ?? ''}
                onMount={handleDiffEditorMount}
                keepCurrentOriginalModel={true}
                keepCurrentModifiedModel={true}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  renderSideBySide: true,
                  scrollbar: {
                    vertical: 'visible',
                    horizontal: 'visible',
                    useShadows: false,
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8
                  }
                }}
              />
            )
          ) : (
            <Editor
              height="100%"
              language={displayFile.language}
              theme="orch-dark"
              path={displayFile.path}
              value={displayFile.content ?? ''}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                renderValidationDecorations: 'off',
                fontSize: 13,
                fontFamily:
                  '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace',
                lineHeight: 1.6,
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                readOnly: true,
                lineNumbersMinChars: 3,
                lineDecorationsWidth: 6,
                folding: false,
                automaticLayout: true,
                cursorBlinking: 'blink',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                contextmenu: true,
                overviewRulerBorder: false,
                overviewRulerLanes: 0,
                scrollbar: {
                  vertical: 'visible',
                  horizontal: 'visible',
                  useShadows: false,
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8
                }
              }}
            />
          )
        ) : (
          <div className={styles.emptyThemePlaceholder} />
        )}
      </div>
    </div>
  )
}
export default CodeEditorView
