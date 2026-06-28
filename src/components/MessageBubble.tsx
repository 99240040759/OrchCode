import { useState, useEffect, useRef, memo } from "react";
import { VscWarning, VscDebugStop, VscChevronRight } from 'react-icons/vsc';
import ToolCallRow from './ToolCallRow';
import { FileIcon } from '@/components/ui/FileIcon';
import { FilePill, ImageThumb } from '@/components/ui/attachment';
import { Markdown } from '@/components/ui/markdown';
import { useUIStore } from '@/store/ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UIMessage, UIPart } from '@/ipc/types';

function MentionChip({ convId, path }: { convId: string; path: string }) {
  return <button type="button" onClick={() => useUIStore.getState().openWorkspaceFile(convId, path)} className="mention font-sans select-none inline-flex my-0.5"><FileIcon fileName={path} className="size-3 shrink-0" /><span>{path}</span></button>;
}
const BubbleImage = ({ convId, name, dataUrl }: { convId: string; name: string; dataUrl?: string }) => <ImageThumb name={name} dataUrl={dataUrl} onClick={dataUrl ? () => useUIStore.getState().openImageViewer(convId, name, dataUrl) : undefined} className="max-h-40 max-w-40 object-contain" />;

function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [mOpen, setMOpen] = useState<boolean | null>(null), wasStr = useRef(isStreaming), open = mOpen !== null ? mOpen : isStreaming;
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (wasStr.current && !isStreaming) setMOpen(false); wasStr.current = isStreaming; }, [isStreaming]);
  useEffect(() => { if (isStreaming && open && containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, [text, isStreaming, open]);
  return text.trim() ? (
    <div className="flex flex-col items-start">
      <Button variant="ghost" onClick={() => setMOpen(!open)} className="text-foreground/35 hover:text-foreground/60 text-xs font-medium -ml-2 px-2 gap-1 h-6">
        <span>Thought</span><VscChevronRight className={cn("size-3 transition-transform duration-100", open && "rotate-90")} />
      </Button>
      {open && <div ref={containerRef} className="mt-0.5 text-xs text-foreground/40 whitespace-pre-wrap leading-relaxed pl-0.5 max-h-[100px] overflow-y-auto">{text}</div>}
    </div>
  ) : null;
}

function UserParts({ parts, convId }: { parts: UIPart[]; convId: string }) {
  return (
    <div className="max-w-xl border border-border/60 rounded-xl rounded-br-sm bg-card px-3 py-2.5 text-sm text-foreground break-words flex flex-col gap-1">
      <div className="whitespace-pre-wrap leading-relaxed">{parts.map(p => p.type === 'text' ? <span key={p.id}>{p.text}</span> : p.type === 'mention' ? <MentionChip key={p.id} convId={convId} path={p.path} /> : null)}</div>
      {parts.some(p => p.type === 'image') && <div className="flex flex-wrap gap-1.5 mt-1">{parts.map(p => p.type === 'image' ? <BubbleImage key={p.id} convId={convId} name={p.name} dataUrl={p.dataUrl} /> : null)}</div>}
      {parts.some(p => p.type === 'file') && <div className="flex flex-wrap gap-1.5 mt-1">{parts.map(p => p.type === 'file' ? <FilePill key={p.id} name={p.name} /> : null)}</div>}
    </div>
  );
}

function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === 'system') return <div className="flex justify-center my-2"><div className="text-xs text-foreground/30 bg-white/4 px-3 py-1 rounded-full border border-border/50">Context summarized — history compressed</div></div>;
  if (msg.role === 'user') return <div className="mb-6 flex justify-end"><UserParts parts={msg.parts} convId={msg.convId} /></div>;
  const hasVisible = msg.parts.length > 0 || msg.status === 'error' || msg.status === 'aborted';
  return hasVisible ? (
    <div className="mb-6 min-w-0 flex flex-col gap-1">
      {msg.parts.map(p => {
        if (p.type === 'text') return <Markdown key={p.id} text={p.text} />;
        if (p.type === 'reasoning') return <ReasoningBlock key={p.id} text={p.text} isStreaming={msg.status === 'streaming' && msg.parts[msg.parts.length - 1]?.id === p.id} />;
        if (p.type === 'tool') return <ToolCallRow key={p.id} tc={p} convId={msg.convId} />;
        if (p.type === 'image') return <BubbleImage key={p.id} convId={msg.convId} name={p.name} dataUrl={p.dataUrl} />;
        return null;
      })}
      {msg.status === 'aborted' && <div className="flex items-center gap-1 text-[11px] text-foreground/30 mt-0.5"><VscDebugStop className="size-3" /> Stopped</div>}
      {msg.status === 'error' && <div className="flex items-center gap-1 text-[11px] text-destructive/70 mt-0.5"><VscWarning className="size-3" /> {msg.error || 'Something went wrong'}</div>}
    </div>
  ) : null;
}
export default memo(MessageBubble);
