import React from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { FileDiff, Search, Copy, Loader } from 'lucide-react'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import Tooltip from './Tooltip'

import type { editor } from 'monaco-editor'

interface CodeEditorViewProps {
  displayFile: { name: string; path: string; content?: string; language?: string; isBinary?: boolean }
  activeWorkspace: { name: string; path: string } | null
  themeLoaded: boolean
  isDiffMode: boolean
  setIsDiffMode: (val: boolean) => void
  originalContent: string | null
  handleDiffEditorMount: (editor: editor.IStandaloneDiffEditor) => void
  handleEditorMount: (editor: editor.IStandaloneCodeEditor) => void
  handleSearchClick: () => void
}

const CodeEditorView: React.FC<CodeEditorViewProps> = ({ displayFile, activeWorkspace, themeLoaded, isDiffMode, setIsDiffMode, originalContent, handleDiffEditorMount, handleEditorMount, handleSearchClick }) => (
  <div className="fv-container">
    <div className="fv-header">
      <div className="fv-file-info-container">
        <span className="fv-file-name">
          {(() => {
            const wName = activeWorkspace ? activeWorkspace.name : 'Workspace'
            const relative = activeWorkspace && displayFile.path.startsWith(activeWorkspace.path) ? displayFile.path.substring(activeWorkspace.path.length) : displayFile.path
            const parts = relative.split(/[/\\]/).filter(Boolean)
            return (
              <span className="fv-breadcrumbs-wrapper">
                <span className="fv-breadcrumb-item">{wName}</span>
                {parts.map((part, idx) => {
                  const isLast = idx === parts.length - 1
                  return (
                    <span key={idx}>
                      <span className="fv-breadcrumb-separator">&nbsp;&gt;&nbsp;</span>
                      {isLast && (
                        <SymbolsFileIcon fileName={displayFile.name} autoAssign={true} width={14} height={14} className="fv-breadcrumb-file-icon" />
                      )}
                      <span className={isLast ? 'fv-breadcrumb-item-active' : 'fv-breadcrumb-item'}>{part}</span>
                    </span>
                  )
                })}
              </span>
            )
          })()}
        </span>
      </div>
      <div className="fv-toolbar-group">
        <Tooltip content={isDiffMode ? 'Show Code Editor' : 'Show File Diff (vs git HEAD)'}><div onClick={() => setIsDiffMode(!isDiffMode)} className={`editor-toolbar-action${isDiffMode ? ' editor-toolbar-action-active' : ''}`}><FileDiff size={13} /></div></Tooltip>
        <Tooltip content="Find in file (native)"><div onClick={handleSearchClick} className="editor-toolbar-action"><Search size={13} /></div></Tooltip>
        <Tooltip content="Copy file content"><div onClick={() => { navigator.clipboard.writeText(displayFile.content ?? ''); toast.success('File content copied!') }} className="editor-toolbar-action"><Copy size={13} /></div></Tooltip>
      </div>
    </div>
    <div className="editor-container">
      {themeLoaded ? (
        isDiffMode ? (
          originalContent === null ? (
            <div className="loading-container"><Loader className="animate-spin" size={16} />Loading diff...</div>
          ) : (
            <DiffEditor height="100%" language={displayFile.language} theme="orch-dark" original={originalContent ?? ''} modified={displayFile.content ?? ''} onMount={handleDiffEditorMount} keepCurrentOriginalModel={true} keepCurrentModifiedModel={true}
              options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, smoothScrolling: false, cursorSmoothCaretAnimation: 'off', scrollbar: { vertical: 'visible', horizontal: 'visible', useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }} />
          )
        ) : (
          <Editor height="100%" language={displayFile.language} theme="orch-dark" path={displayFile.path} value={displayFile.content ?? ''} onMount={handleEditorMount}
            options={{ minimap: { enabled: false }, fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace', lineHeight: 1.6, padding: { top: 16 }, scrollBeyondLastLine: false, wordWrap: 'on', readOnly: true, lineNumbersMinChars: 3, lineDecorationsWidth: 6, folding: false, automaticLayout: true, cursorBlinking: 'blink', cursorSmoothCaretAnimation: 'off', smoothScrolling: false, contextmenu: true, overviewRulerBorder: false, overviewRulerLanes: 0, scrollbar: { vertical: 'visible', horizontal: 'visible', useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }} />
        )
      ) : (
        <div className="empty-theme-placeholder" />
      )}
    </div>
  </div>
)
export default CodeEditorView
