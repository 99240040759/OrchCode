import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallRow from './ToolCallRow';
import type { UIMessage } from '@/ipc/types';
export default function MessageBubble({ msg, isStreaming }: { msg: UIMessage; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';
  if (msg.role === 'system') return (
    <div className="flex justify-center my-3">
      <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-full border">Context summarized — history compressed</div>
    </div>
  );
  const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('');
  const tools = msg.parts.filter(p => p.type === 'tool-call') as Extract<UIMessage['parts'][number], { type: 'tool-call' }>[];
  if (!text && tools.length === 0 && !isStreaming) return null;
  if (isUser) return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[80%] bg-muted/60 rounded-2xl rounded-br-sm px-4 py-2.5 text-chat text-foreground whitespace-pre-wrap break-words">{text}</div>
    </div>
  );
  return (
    <div className="mb-3 min-w-0">
      {text && <div className="prose prose-chat min-w-0"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>}
      {tools.length > 0 && <div className={`flex flex-col gap-0.5 ${text ? 'mt-1.5' : ''}`}>{tools.map(tc => <ToolCallRow key={tc.id} tc={tc} convId={msg.convId} />)}</div>}
    </div>
  );
}
