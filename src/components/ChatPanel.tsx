import { useEffect, useRef } from "react";
import { useConversationsStore } from '@/store/conversations';
import { useModelsStore } from '@/store/models';
import MessageBubble from './MessageBubble';
import TiptapInput from './TiptapInput';
import { sendMessage, stopAgent } from '@/lib/agentService';
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
export default function ChatPanel({ convId, workspaceId, workspacePath, compact }: { convId: string; workspaceId: string | null; workspacePath: string | null; compact?: boolean }) {
  const conv = useConversationsStore(s => s.convs[convId]);
  const selectedModel = useModelsStore(s => s.models[s.selectedKey] ?? null);
  const messages = conv?.messages || [];
  const currentMessage = conv?.currentMessage || null;
  const isStreaming = conv?.isStreaming || false;
  const tokenCount = conv?.tokenCount || 0;
  const contextWindow = selectedModel?.contextWindow || 128000;
  const isEmpty = messages.length === 0 && !isStreaming && !currentMessage;
  const showThinking = isStreaming && !currentMessage;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, currentMessage]);
  const handleSend = async (text: string, _mentions: string[], attachments?: Array<{ name: string; dataUrl: string; mimeType: string }>) => {
    if ((!text.trim() && !attachments?.length) || isStreaming) return;
    pinned.current = true;
    await sendMessage(convId, workspacePath, text, attachments);
  };
  const handleStop = () => stopAgent(convId);
  const inputBar = <TiptapInput key={convId} onSubmit={handleSend} onStop={handleStop} workspacePath={workspacePath} disabled={isStreaming} isStreaming={isStreaming} tokenCount={tokenCount} contextWindow={contextWindow} />;
  if (compact) return <div className="px-3 py-2">{inputBar}</div>;
  if (isEmpty) return (
    <div className="h-full flex flex-col items-center justify-center bg-background">
      <div className="w-full max-w-[700px] px-5">
        {workspacePath && <p className="text-xs text-muted-foreground/40 mb-3 font-mono truncate">{workspacePath}</p>}
        {inputBar}
      </div>
    </div>
  );
  return (
    <div className="h-full flex flex-col bg-background">
      <div ref={scrollerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[700px] px-5 pt-4 pb-2">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
          {showThinking && <ThinkingIndicator />}
          {currentMessage && <MessageBubble msg={currentMessage} isStreaming />}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="shrink-0 py-3">
        <div className="mx-auto w-full max-w-[700px] px-5">{inputBar}</div>
      </div>
    </div>
  );
}
