import React, { useCallback, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { useConversationsStore } from '@/store/conversations';
import { useAuthStore } from '@/store/auth';
import { useModelsStore } from '@/store/models';
import MessageBubble from './MessageBubble';
import TiptapInput from './TiptapInput';
import type { UIMessage } from '@/ipc/types';
import { el } from '@/lib/electron';
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
  const conv = useConversationsStore(s => s.convs.get(convId));
  const { addMessage, cancelStream } = useConversationsStore();
  const accessToken = useAuthStore(s => s.accessToken);
  const selectedModel = useModelsStore(s => s.models[s.selectedKey] ?? null);
  const messages = conv?.messages || [];
  const currentMessage = conv?.currentMessage || null;
  const isStreaming = conv?.isStreaming || false;
  const tokenCount = conv?.tokenCount || 0;
  const agentReady = conv?.agentReady || false;
  const contextWindow = selectedModel?.contextWindow || 128000;
  const isEmpty = messages.length === 0 && !isStreaming && !currentMessage;
  const showThinking = isStreaming && !currentMessage;
  // Pin-to-bottom
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages, currentMessage]);
  const handleSend = useCallback(async (text: string, _mentions: string[], attachments?: Array<{ name: string; dataUrl: string; mimeType: string }>) => {
    if ((!text.trim() && !attachments?.length) || isStreaming) return;
    if (!accessToken || !selectedModel) return;
    pinned.current = true;
    let content: any = text;
    if (attachments?.length && selectedModel.multimodal) {
      const parts: any[] = [];
      if (text.trim()) parts.push({ type: 'text', text: text.trim() });
      for (const a of attachments) {
        if (a.mimeType.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
        else parts.push({ type: 'text', text: `[Attached file: ${a.name}]` });
      }
      content = parts;
    }
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    const historySnapshot = useConversationsStore.getState().convs.get(convId)?.messages || [];
    const userMsg: UIMessage = { id: nanoid(), convId, role: 'user', parts: [{ type: 'text', text: contentStr }], createdAt: Date.now() };
    addMessage(convId, userMsg);
    // Write to DB using legacy Message format (schema unchanged)
    el.writeMessage({ id: userMsg.id, convId, role: 'user', content: contentStr, tokenCount: 0, createdAt: userMsg.createdAt });
    const userDataPath = await el.getUserDataPath();
    const sessionDir = `${userDataPath}/sessions/${convId}`;
    // Build history for worker using legacy Message format
    const history = historySnapshot.flatMap(m => m.parts
      .filter(p => p.type === 'text' && m.role !== 'system')
      .map(p => ({ id: m.id, convId, role: m.role as any, content: (p as any).text, tokenCount: 0, createdAt: m.createdAt }))
    );
    const agentConfig = {
      convId, workspacePath, sessionDir, history,
      jwt: accessToken, anonKey: el.anonKey, gcpBase: el.gcpBase,
      modelId: selectedModel.id, provider: selectedModel.provider,
      contextWindow: selectedModel.contextWindow, reasoningEffort: selectedModel.reasoningEffort,
    };
    if (agentReady) { el.sendToAgent(convId, { type: 'send', content: contentStr }); }
    else { el.spawnAgent(agentConfig); el.sendToAgent(convId, { type: 'send', content: contentStr }); }
  }, [convId, workspacePath, isStreaming, agentReady, addMessage, accessToken, selectedModel]);
  const handleStop = useCallback(() => { el.killAgent(convId); cancelStream(convId); el.removeAgentPort(convId); }, [convId, cancelStream]);
  const inputBar = <TiptapInput onSubmit={handleSend} onStop={handleStop} workspacePath={workspacePath} disabled={isStreaming} isStreaming={isStreaming} tokenCount={tokenCount} contextWindow={contextWindow} />;
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
