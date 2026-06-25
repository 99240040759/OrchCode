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
      <div className="h-8 min-h-8 max-h-8 px-3 border-b border-border/60 flex items-center justify-between shrink-0 bg-sidebar">
        <div className="flex items-center gap-1 overflow-hidden min-w-0"><FileBreadcrumb filePath={filePath} /></div>
        <div className="flex items-center gap-1.5 shrink-0 select-none">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-emerald-400">+{diff.added}</span>
            <span className="text-red-400">-{diff.removed}</span>
          </div>
          {hasDiff && onToggleDiff && (
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={onToggleDiff} className="text-foreground/35 hover:text-foreground/70"><VscCode className="size-3" /></Button></TooltipTrigger><TooltipContent side="bottom">Show File</TooltipContent></Tooltip>
          )}
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={handleSearch} className="text-foreground/35 hover:text-foreground/70"><FluentSearch className="size-3" /></Button></TooltipTrigger><TooltipContent side="bottom">Search</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={handleCopy} className="text-foreground/35 hover:text-foreground/70">{copied ? <IoCheckmark className="size-3 text-emerald-400" /> : <FluentFiles className="size-3" />}</Button></TooltipTrigger><TooltipContent side="bottom">{copied ? 'Copied' : 'Copy'}</TooltipContent></Tooltip>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <DiffEditor height="100%" original={original} modified={modified} language={lang} theme="orchTheme" options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', lineDecorationsWidth: 10, lineNumbersMinChars: 4, folding: false, renderLineHighlight: 'none', padding: { top: 12, bottom: 12 } }} onMount={editor => editorRef.current = editor} />
      </div>
    </div>
  );
}
