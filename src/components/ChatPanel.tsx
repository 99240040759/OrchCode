import { useEffect, useRef } from "react";
import { useConversationsStore } from '@/store/conversations';
import MessageBubble from './MessageBubble';
import TiptapInput from './TiptapInput';
import { sendMessage, stopAgent, type EditorPart, type Attachment } from '@/lib/agentService';
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 mb-5 py-1 text-sm text-muted-foreground">
      <div className="flex gap-1">
        <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '0ms' }} />
        <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="animate-pulse font-medium">Thinking</span>
    </div>
  );
}
export default function ChatPanel({ convId, workspacePath, compact }: { convId: string; workspaceId: string | null; workspacePath: string | null; compact?: boolean }) {
  const conv = useConversationsStore(s => s.convs[convId]);
  const messages = conv?.messages || [];
  const busy = conv?.status === 'busy';
  const last = messages[messages.length - 1];
  const showThinking = busy && (!last || last.role !== 'assistant' || last.parts.length === 0);
  const isEmpty = messages.length === 0 && !busy;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const handleScroll = () => { const el = scrollerRef.current; if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
  useEffect(() => { if (pinned.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' }); }, [messages]);
  const handleSend = (parts: EditorPart[], attachments?: Attachment[]) => {
    if (busy) return;
    pinned.current = true;
    sendMessage(convId, workspacePath, parts, attachments);
  };
  const inputBar = <TiptapInput key={convId} onSubmit={handleSend} onStop={() => stopAgent(convId)} workspacePath={workspacePath} disabled={busy} isStreaming={busy} />;
  if (compact) return <div className="px-3 py-2">{inputBar}</div>;
  if (isEmpty) return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-3xl px-5">
        {workspacePath && <p className="text-xs text-muted-foreground/40 mb-3 font-mono truncate">{workspacePath}</p>}
        {inputBar}
      </div>
    </div>
  );
  return (
    <div className="h-full flex flex-col bg-background">
      <div ref={scrollerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pt-4 pb-2">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
          {showThinking && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 py-3">
        <div className="mx-auto w-full max-w-3xl px-5">{inputBar}</div>
      </div>
    </div>
  );
}
