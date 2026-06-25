import { useEffect, useState, useRef } from "react";
import { DiffEditor } from '@monaco-editor/react';
import { FileBreadcrumb } from '@/components/ui/FileBreadcrumb';
import { getLang } from '@/lib/langMap';
import { FluentSearch, FluentFiles } from '@react-symbols/icons';
import { IoCheckmark } from 'react-icons/io5';
import { VscCode } from 'react-icons/vsc';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { computeDiff } from '@/agent/diff';
export default function FileDiffViewer({ filePath, original, modified, hasDiff, viewMode, onToggleDiff }: { filePath: string; original: string; modified: string; hasDiff?: boolean; viewMode?: 'viewer' | 'diff'; onToggleDiff?: () => void }) {
  const [diff, setDiff] = useState({ added: 0, removed: 0 });
  useEffect(() => { const t = setTimeout(() => setDiff(computeDiff(original, modified)), 50); return () => clearTimeout(t); }, [original, modified]);
  const lang = getLang(filePath);
  const editorRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);
  const handleSearch = () => { const med = editorRef.current?.getModifiedEditor(); med?.focus(); med?.trigger('actions.find', 'actions.find'); };
  const handleCopy = () => { navigator.clipboard.writeText(modified); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="h-9 min-h-9 max-h-9 px-3 border-b text-xs text-muted-foreground flex items-center justify-between shrink-0 bg-muted/5">
        <div className="flex items-center gap-1.5 overflow-hidden"><FileBreadcrumb filePath={filePath} /></div>
        <div className="flex items-center gap-3 shrink-0 select-none">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-green-400">+{diff.added}</span>
            <span className="text-red-400">-{diff.removed}</span>
          </div>
          {hasDiff && onToggleDiff && (
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onToggleDiff} className="text-muted-foreground cursor-pointer"><VscCode className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Show File</TooltipContent></Tooltip>
          )}
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handleSearch} className="text-muted-foreground cursor-pointer"><FluentSearch className="size-4" /></Button></TooltipTrigger><TooltipContent side="bottom">Search in Diff</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={handleCopy} className="text-muted-foreground cursor-pointer">{copied ? <IoCheckmark className="size-4 text-green-400" /> : <FluentFiles className="size-4" />}</Button></TooltipTrigger><TooltipContent side="bottom">{copied ? "Copied" : "Copy Modified Content"}</TooltipContent></Tooltip>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <DiffEditor height="100%" original={original} modified={modified} language={lang} theme="orchTheme" options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', lineDecorationsWidth: 6, lineNumbersMinChars: 3, folding: false, renderLineHighlight: 'none' }} onMount={editor => editorRef.current = editor} />
      </div>
    </div>
  );
}
