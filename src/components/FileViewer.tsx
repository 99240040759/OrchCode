import { useState, useRef } from "react";
import Editor from '@monaco-editor/react';
import { Markdown } from '@/components/ui/markdown';
import { FileBreadcrumb } from '@/components/ui/FileBreadcrumb';
import { getLang } from '@/lib/langMap';
import { FluentSearch, FluentFiles } from '@react-symbols/icons';
import { IoCheckmark } from 'react-icons/io5';
import { VscDiff } from 'react-icons/vsc';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
export default function FileViewer({ filePath, content, startLine, endLine, hasDiff, viewMode, onToggleDiff }: { filePath: string; content: string; startLine: number; endLine: number; hasDiff?: boolean; viewMode?: 'viewer' | 'diff'; onToggleDiff?: () => void }) {
  const lang = getLang(filePath);
  const editorRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    const totalLines = content.split('\n').length;
    if ((endLine - startLine + 1) < totalLines) {
      const decorations = [];
      for (let i = startLine; i <= endLine; i++) {
        decorations.push({ range: new monaco.Range(i, 1, i, 1), options: { isWholeLine: true, className: 'monaco-highlight-line', marginClassName: 'monaco-highlight-line-margin' } });
      }
      editor.createDecorationsCollection(decorations);
    }
    editor.revealLineInCenter(startLine);
  };
  const handleSearch = () => { editorRef.current?.focus(); editorRef.current?.trigger('actions.find', 'actions.find'); };
  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="h-9 min-h-9 max-h-9 px-3 border-b text-xs text-muted-foreground flex items-center justify-between shrink-0 bg-muted/5">
        <div className="flex items-center gap-1.5 overflow-hidden"><FileBreadcrumb filePath={filePath} /></div>
        <div className="flex items-center gap-1.5 shrink-0 select-none">
          {hasDiff && onToggleDiff && (
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onToggleDiff} className="text-muted-foreground cursor-pointer"><VscDiff className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Show Changes</TooltipContent></Tooltip>
          )}
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handleSearch} className="text-muted-foreground cursor-pointer"><FluentSearch className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Search in File</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handleCopy} className="text-muted-foreground cursor-pointer">{copied ? <IoCheckmark className="size-4 text-green-400" /> : <FluentFiles className="size-4" />}</Button></TooltipTrigger><TooltipContent side="bottom">{copied ? "Copied" : "Copy Content"}</TooltipContent></Tooltip>
        </div>
      </div>
      <style>{`.monaco-highlight-line { background: hsl(42 53% 83% / 0.08) !important; } .monaco-highlight-line-margin { border-left: 2px solid hsl(42 53% 83%); }`}</style>
      <div className="flex-1 min-h-0 pl-3 pt-3 overflow-y-auto">
        {filePath.toLowerCase().endsWith('.md') ? (
          <div className="pr-3 pb-3 max-w-4xl">
            <Markdown text={content} />
          </div>
        ) : (
          <Editor height="100%" language={lang} theme="orchTheme" value={content} options={{ readOnly: true, lineNumbers: 'on', minimap: { enabled: false }, scrollBeyondLastLine: false, lineDecorationsWidth: 6, lineNumbersMinChars: 3, wordWrap: 'on', domReadOnly: true, folding: false, renderLineHighlight: 'none' }} onMount={handleEditorDidMount} />
        )}
      </div>
    </div>
  );
}
