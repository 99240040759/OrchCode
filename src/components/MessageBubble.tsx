import { useState } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { IoCopyOutline, IoCheckmark } from 'react-icons/io5';
import { VscWarning, VscDebugStop } from 'react-icons/vsc';
import ToolCallRow from './ToolCallRow';
import { FileIcon } from '@/components/ui/FileIcon';
import { useUIStore } from '@/store/ui';
import { useConversationsStore } from '@/store/conversations';
import { useWorkspacesStore } from '@/store/workspaces';
import { el } from '@/lib/electron';
import type { UIMessage, UIPart } from '@/ipc/types';
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-white/[0.06]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.06]">
        <span className="text-xs text-muted-foreground/60 font-mono">{language || 'text'}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
          {copied ? <><IoCheckmark className="size-3 text-green-400" /><span className="text-green-400">Copied</span></> : <><IoCopyOutline className="size-3" />Copy</>}
        </button>
      </div>
      <SyntaxHighlighter language={language || 'text'} style={vscDarkPlus} customStyle={{ margin: 0, borderRadius: 0, background: 'transparent' }}>
        {children}
      </SyntaxHighlighter>
    </div>
  );
}
const mdComponents: any = {
  code({ inline, className, children, ...props }: any) {
    const lang = /language-(\w+)/.exec(className || '')?.[1] || '';
    return inline ? <code className={className} {...props}>{children}</code> : <CodeBlock language={lang}>{String(children).replace(/\n$/, '')}</CodeBlock>;
  },
};
const Markdown = ({ text }: { text: string }) => <div className="prose prose-chat min-w-0"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>{text}</ReactMarkdown></div>;
function MentionChip({ convId, path }: { convId: string; path: string }) {
  const open = async () => {
    const conv = useConversationsStore.getState().convs[convId];
    const ws = useWorkspacesStore.getState().workspaces.find(w => w.id === conv?.workspaceId);
    if (!ws) return;
    const content = await el.readWorkspaceFile(ws.path, path);
    useUIStore.getState().openFileViewer(convId, path, content, 1, content.split('\n').length);
  };
  return (
    <button onClick={open} className="px-1.5 py-0.5 bg-accent/50 hover:bg-accent/85 text-accent-foreground rounded-md inline-flex items-center gap-1 font-mono text-xs cursor-pointer transition-colors align-middle mx-0.5">
      <FileIcon fileName={path} className="size-3.5 shrink-0" /><span>{path}</span>
    </button>
  );
}
function ImageThumb({ convId, name, dataUrl }: { convId: string; name: string; dataUrl?: string }) {
  if (!dataUrl) return null;
  return <img src={dataUrl} alt={name} onClick={() => useUIStore.getState().openImageViewer(convId, name, dataUrl)} className="max-w-64 max-h-64 rounded-lg border border-border/60 my-1 cursor-pointer object-contain" />;
}
function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="my-1">
      <button onClick={() => setOpen(o => !o)} className="text-xs text-muted-foreground/60 hover:text-muted-foreground italic">{open ? 'Hide reasoning' : 'Show reasoning'}</button>
      {open && <div className="mt-1 pl-3 border-l-2 border-border/50 text-xs text-muted-foreground/70 whitespace-pre-wrap">{text}</div>}
    </div>
  );
}
function UserParts({ parts, convId }: { parts: UIPart[]; convId: string }) {
  return (
    <div className="max-w-3xl bg-muted/60 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-foreground break-words flex flex-col gap-1">
      <div className="whitespace-pre-wrap leading-relaxed">
        {parts.map(p => p.type === 'text' ? <span key={p.id}>{p.text}</span> : p.type === 'mention' ? <MentionChip key={p.id} convId={convId} path={p.path} /> : null)}
      </div>
      {parts.some(p => p.type === 'image') && <div className="flex flex-wrap gap-1.5">{parts.map(p => p.type === 'image' ? <ImageThumb key={p.id} convId={convId} name={p.name} dataUrl={p.dataUrl} /> : null)}</div>}
      {parts.filter(p => p.type === 'file').map(p => p.type === 'file' ? <div key={p.id} className="inline-flex items-center gap-1.5 bg-background/40 rounded-md px-2 py-1 text-xs w-fit"><FileIcon fileName={p.name} className="size-3.5" />{p.name}</div> : null)}
    </div>
  );
}
export default function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.role === 'system') return (
    <div className="flex justify-center my-3"><div className="text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border">Context summarized — history compressed</div></div>
  );
  if (msg.role === 'user') return <div className="mb-8 flex justify-end"><UserParts parts={msg.parts} convId={msg.convId} /></div>;
  // assistant
  const hasVisible = msg.parts.length > 0 || msg.status === 'error' || msg.status === 'aborted';
  if (!hasVisible) return null;
  return (
    <div className="mb-8 min-w-0 flex flex-col gap-0.5">
      {msg.parts.map(p => {
        if (p.type === 'text') return <Markdown key={p.id} text={p.text} />;
        if (p.type === 'reasoning') return <ReasoningBlock key={p.id} text={p.text} />;
        if (p.type === 'tool') return <ToolCallRow key={p.id} tc={p} convId={msg.convId} />;
        if (p.type === 'image') return <ImageThumb key={p.id} convId={msg.convId} name={p.name} dataUrl={p.dataUrl} />;
        return null;
      })}
      {msg.status === 'aborted' && <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70 mt-1"><VscDebugStop className="size-3.5" /> Stopped</div>}
      {msg.status === 'error' && <div className="flex items-center gap-1.5 text-xs text-destructive mt-1"><VscWarning className="size-3.5" /> {msg.error || 'Something went wrong'}</div>}
    </div>
  );
}
