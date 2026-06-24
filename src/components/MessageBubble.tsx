import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { IoCopyOutline, IoCheckmark } from 'react-icons/io5';
import ToolCallRow from './ToolCallRow';
import type { UIMessage } from '@/ipc/types';
function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-white/[0.06]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.06]">
        <span className="text-[11px] text-muted-foreground/60 font-mono">{language || 'text'}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
          {copied ? <><IoCheckmark className="size-3 text-green-400" /><span className="text-green-400">Copied</span></> : <><IoCopyOutline className="size-3" />Copy</>}
        </button>
      </div>
      <SyntaxHighlighter language={language || 'text'} style={vscDarkPlus} customStyle={{ margin: 0, borderRadius: 0, background: 'hsl(0 0% 8%)', fontSize: '13px', lineHeight: '1.6' }} codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}>
        {children}
      </SyntaxHighlighter>
    </div>
  );
}
const mdComponents: any = {
  code({ node, inline, className, children, ...props }: any) {
    const lang = /language-(\w+)/.exec(className || '')?.[1] || '';
    return inline
      ? <code className={className} {...props}>{children}</code>
      : <CodeBlock language={lang}>{String(children).replace(/\n$/, '')}</CodeBlock>;
  },
};
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
    <div className="mb-0.5 min-w-0">
      {text && <div className="prose prose-chat min-w-0"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>{text}</ReactMarkdown></div>}
      {tools.length > 0 && <div className={`flex flex-col gap-0.5 ${text ? 'mt-1' : ''}`}>{tools.map(tc => <ToolCallRow key={tc.id} tc={tc} convId={msg.convId} />)}</div>}
    </div>
  );
}
