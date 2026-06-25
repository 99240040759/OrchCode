import { useState, useEffect, useRef } from "react";
import { VscWarning, VscDebugStop, VscChevronRight } from 'react-icons/vsc';
import ToolCallRow from './ToolCallRow';
import { FileIcon } from '@/components/ui/FileIcon';
import { Markdown } from '@/components/ui/markdown';
import { useUIStore } from '@/store/ui';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { el } from '@/lib/electron';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UIMessage, UIPart } from '@/ipc/types';
function MentionChip({ convId, path }: { convId: string; path: string }) {
  const open = async () => {
    const conv = useConversationsStore.getState().convs[convId], ws = useWorkspacesStore.getState().workspaces.find(w => w.id === conv?.workspaceId);
    if (ws) { const c = await el.readWorkspaceFile(ws.path, path); useUIStore.getState().openFileViewer(convId, path, c, 1, c.split('\n').length); }
  };
  return <Button variant="inline-code" size="inline-code" onClick={open}><FileIcon fileName={path} className="size-3.5 shrink-0" /><span>{path}</span></Button>;
}
const ImageThumb = ({ convId, name, dataUrl }: any) => dataUrl ? <img src={dataUrl} alt={name} onClick={() => useUIStore.getState().openImageViewer(convId, name, dataUrl)} className="max-w-64 max-h-64 rounded-lg border border-border my-1 cursor-pointer object-contain" /> : null;
function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [mOpen, setMOpen] = useState<boolean | null>(null), wasStr = useRef(isStreaming), open = mOpen !== null ? mOpen : isStreaming;
  useEffect(() => { if (wasStr.current && !isStreaming) setMOpen(false); wasStr.current = isStreaming; }, [isStreaming]);
  return text.trim() ? <div className="my-1 flex flex-col items-start"><Button variant="ghost" onClick={() => setMOpen(!open)} className="text-muted-foreground hover:text-foreground font-medium"><span>Thought</span><VscChevronRight className={cn("size-3 transition-transform duration-150", open && "rotate-90")} /></Button>{open && <div className="mt-1 pl-3 border-l border-border text-sm text-muted-foreground whitespace-pre-wrap">{text}</div>}</div> : null;
}
function UserParts({ parts, convId }: { parts: UIPart[]; convId: string }) {
  return (
    <div className="max-w-3xl border border-border rounded-2xl rounded-br-sm bg-card px-3 py-3 text-base text-foreground break-words flex flex-col gap-1">
      <div className="whitespace-pre-wrap leading-relaxed">{parts.map(p => p.type === 'text' ? <span key={p.id}>{p.text}</span> : p.type === 'mention' ? <MentionChip key={p.id} convId={convId} path={p.path} /> : null)}</div>
      {parts.some(p => p.type === 'image') && <div className="flex flex-wrap gap-1.5">{parts.map(p => p.type === 'image' ? <ImageThumb key={p.id} convId={convId} name={p.name} dataUrl={p.dataUrl} /> : null)}</div>}
      {parts.filter(p => p.type === 'file').map(p => p.type === 'file' ? <div key={p.id} className="inline-flex items-center gap-1.5 bg-background rounded-md px-2 py-1 text-xs w-fit"><FileIcon fileName={p.name} className="size-3.5" />{p.name}</div> : null)}
    </div>
  );
}
export default function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === 'system') return <div className="flex justify-center my-3"><div className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full border">Context summarized — history compressed</div></div>;
  if (msg.role === 'user') return <div className="mb-8 flex justify-end"><UserParts parts={msg.parts} convId={msg.convId} /></div>;
  const hasVisible = msg.parts.length > 0 || msg.status === 'error' || msg.status === 'aborted';
  return hasVisible ? (
    <div className="mb-8 min-w-0 flex flex-col gap-0.5">
      {msg.parts.map(p => {
        if (p.type === 'text') return <Markdown key={p.id} text={p.text} />;
        if (p.type === 'reasoning') return <ReasoningBlock key={p.id} text={p.text} isStreaming={msg.status === 'streaming' && msg.parts[msg.parts.length - 1]?.id === p.id} />;
        if (p.type === 'tool') return <ToolCallRow key={p.id} tc={p} convId={msg.convId} />;
        if (p.type === 'image') return <ImageThumb key={p.id} convId={msg.convId} name={p.name} dataUrl={p.dataUrl} />;
        return null;
      })}
      {msg.status === 'aborted' && <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1"><VscDebugStop className="size-3.5" /> Stopped</div>}
      {msg.status === 'error' && <div className="flex items-center gap-1.5 text-xs text-destructive mt-1"><VscWarning className="size-3.5" /> {msg.error || 'Something went wrong'}</div>}
    </div>
  ) : null;
}
