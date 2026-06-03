import React from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { FileDiff, Search, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

interface CodeEditorViewProps {
  displayFile: {
    name: string
    path: string
    content?: string
    language?: string
    isBinary?: boolean
  }
  activeWorkspace: { path: string } | null
  getDisplayName: (name: string) => string
  getRelativeDirPath: (filePath: string, workspacePath?: string) => string
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
  getDisplayName,
  getRelativeDirPath,
  themeLoaded,
  isDiffMode,
  setIsDiffMode,
  originalContent,
  handleDiffEditorMount,
  handleEditorMount,
  handleSearchClick
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        flex: 1
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '34px',
          padding: '0 16px',
          backgroundColor: 'var(--bg-app)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}
        >
          <SymbolsFileIcon
            fileName={displayFile.name}
            autoAssign={true}
            width={16}
            height={16}
            style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
          />
          <span
            style={{
              color: 'var(--text-primary)',
              fontWeight: 500,
              fontSize: 'var(--font-size-sm)',
              whiteSpace: 'nowrap'
            }}
          >
            {getDisplayName(displayFile.name)}
          </span>
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-xs)',
              marginLeft: '4px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {getRelativeDirPath(displayFile.path, activeWorkspace?.path)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div
            title={isDiffMode ? 'Show Code Editor' : 'Show File Diff (vs git HEAD)'}
            onClick={() => setIsDiffMode(!isDiffMode)}
            className={
              isDiffMode ? 'editor-toolbar-action active' : 'editor-toolbar-action'
            }
          >
            <FileDiff size={13} />
          </div>
          <div
            title="Find in file (native)"
            onClick={handleSearchClick}
            className="editor-toolbar-action"
          >
            <Search size={13} />
          </div>
          <div
            title="Copy file content"
            onClick={() => {
              navigator.clipboard.writeText(displayFile.content ?? '')
              toast.success('File content copied!')
            }}
            className="editor-toolbar-action"
          >
            <Copy size={13} />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg-app)' }}>
        {themeLoaded ? (
          isDiffMode ? (
            originalContent === null ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-secondary)'
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: '2px solid var(--text-secondary)',
                    borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                    marginRight: 8
                  }}
                />
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
          <div
            style={{ width: '100%', height: '100%', backgroundColor: 'var(--bg-app)' }}
          />
        )}
      </div>
    </div>
  )
}
export default CodeEditorView
