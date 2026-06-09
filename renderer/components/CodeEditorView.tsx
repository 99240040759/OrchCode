import React from 'react'
import { Editor, DiffEditor } from '@monaco-editor/react'
import { FileDiff, Search, Copy, Loader } from 'lucide-react'
import { toast } from 'sonner'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import { getDisplayName, getRelativeDirPath } from '../lib/uiUtils'

import type { editor } from 'monaco-editor'

interface CodeEditorViewProps {
  displayFile: { name: string; path: string; content?: string; language?: string; isBinary?: boolean }
  activeWorkspace: { path: string } | null
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
        <SymbolsFileIcon fileName={displayFile.name} autoAssign={true} width={16} height={16} className="fv-file-icon" />
        <span className="fv-file-name">{getDisplayName(displayFile.name)}</span>
        <span className="fv-file-dir">{getRelativeDirPath(displayFile.path, activeWorkspace?.path)}</span>
      </div>
      <div className="fv-toolbar-group">
        <div title={isDiffMode ? 'Show Code Editor' : 'Show File Diff (vs git HEAD)'} onClick={() => setIsDiffMode(!isDiffMode)} className={`editor-toolbar-action${isDiffMode ? ' editor-toolbar-action-active' : ''}`}>
          <FileDiff size={13} />
        </div>
        <div title="Find in file (native)" onClick={handleSearchClick} className="editor-toolbar-action"><Search size={13} /></div>
        <div title="Copy file content" onClick={() => { navigator.clipboard.writeText(displayFile.content ?? ''); toast.success('File content copied!') }} className="editor-toolbar-action"><Copy size={13} /></div>
      </div>
    </div>
    <div className="editor-container">
      {themeLoaded ? (
        isDiffMode ? (
          originalContent === null ? (
            <div className="loading-container"><Loader className="animate-spin" size={16} style={{ marginRight: '8px', color: 'var(--text-secondary)' }} />Loading diff...</div>
          ) : (
            <DiffEditor height="100%" language={displayFile.language} theme="orch-dark" original={originalContent ?? ''} modified={displayFile.content ?? ''} onMount={handleDiffEditorMount} keepCurrentOriginalModel={true} keepCurrentModifiedModel={true}
              options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, scrollbar: { vertical: 'visible', horizontal: 'visible', useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }} />
          )
        ) : (
          <Editor height="100%" language={displayFile.language} theme="orch-dark" path={displayFile.path} value={displayFile.content ?? ''} onMount={handleEditorMount}
            options={{ minimap: { enabled: false }, renderValidationDecorations: 'off', fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Monaco, Menlo, Consolas, monospace', lineHeight: 1.6, padding: { top: 16 }, scrollBeyondLastLine: false, wordWrap: 'on', readOnly: true, lineNumbersMinChars: 3, lineDecorationsWidth: 6, folding: false, automaticLayout: true, cursorBlinking: 'blink', cursorSmoothCaretAnimation: 'on', smoothScrolling: true, contextmenu: true, overviewRulerBorder: false, overviewRulerLanes: 0, scrollbar: { vertical: 'visible', horizontal: 'visible', useShadows: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 } }} />
        )
      ) : (
        <div className="empty-theme-placeholder" />
      )}
    </div>
  </div>
)
export default CodeEditorView
