import { useState, useRef } from "react";
import Editor from '@monaco-editor/react';
import { FileBreadcrumb } from '@/components/ui/FileBreadcrumb';
import { getLang } from '@/lib/langMap';
import { FluentSearch, FluentFiles } from '@react-symbols/icons';
import { IoCheckmark } from 'react-icons/io5';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
export default function FileViewer({ filePath, content, startLine, endLine }: { filePath: string; content: string; startLine: number; endLine: number }) {
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
      <div className="h-9 min-h-[36px] max-h-[36px] px-3 border-b text-sm text-muted-foreground flex items-center justify-between shrink-0 bg-muted/5">
        <div className="flex items-center gap-1.5 overflow-hidden"><FileBreadcrumb filePath={filePath} /></div>
        <div className="flex items-center gap-1.5 shrink-0 select-none">
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={handleSearch} className="text-muted-foreground cursor-pointer"><FluentSearch className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Search in File</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={handleCopy} className="text-muted-foreground cursor-pointer">{copied ? <IoCheckmark className="size-4 text-green-400" /> : <FluentFiles className="size-4" />}</Button></TooltipTrigger><TooltipContent side="bottom">{copied ? "Copied" : "Copy Content"}</TooltipContent></Tooltip>
        </div>
      </div>
      <style>{`.monaco-highlight-line { background: hsl(42 53% 83% / 0.08) !important; } .monaco-highlight-line-margin { border-left: 2px solid hsl(42 53% 83%); }`}</style>
      <div className="flex-1 min-h-0 pl-3 pt-3">
        <Editor height="100%" language={lang} theme="vs-dark" value={content} options={{ readOnly: true, lineNumbers: 'on', minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 14, fontFamily: 'var(--font-mono)', lineDecorationsWidth: 6, lineNumbersMinChars: 3, wordWrap: 'on', domReadOnly: true, folding: false, renderLineHighlight: 'none' }} onMount={handleEditorDidMount} />
      </div>
    </div>
  );
}
