import { useState, memo } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { VscCopy, VscCheck } from "react-icons/vsc";
import { Button } from "@/components/ui/button";

/* Warm earth syntax palette — matches the Monaco orchTheme tokens */
const c = (color: string) => ({ color });
const warmCode: any = {
  'code[class*="language-"]': { color: '#f0e0cf', fontFamily: 'var(--font-mono)', background: 'none' },
  'pre[class*="language-"]': { color: '#f0e0cf', background: 'transparent' },
  comment: { color: '#8a7560', fontStyle: 'italic' }, prolog: c('#8a7560'), doctype: c('#8a7560'), cdata: c('#8a7560'),
  punctuation: c('#b8a692'), operator: c('#b8a692'), delimiter: c('#b8a692'),
  property: c('#e08a5f'), boolean: c('#e08a5f'), number: c('#e08a5f'), constant: c('#e08a5f'), symbol: c('#e08a5f'),
  tag: c('#c08bb0'), keyword: c('#c08bb0'), atrule: c('#c08bb0'),
  string: c('#9caa6b'), char: c('#9caa6b'), selector: c('#9caa6b'), inserted: c('#9caa6b'),
  'attr-name': c('#dca24a'), entity: c('#dca24a'), regex: c('#dca24a'),
  builtin: c('#d9b88a'), 'class-name': c('#d9b88a'),
  function: c('#7fa0b8'), url: c('#7fb8b0'), variable: c('#f0e0cf'), deleted: c('#cf5a44'), important: c('#cf5a44'),
};

const CodeBlock = memo(function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div className="relative group my-2.5 rounded-md overflow-hidden bg-card border border-border/50 shadow-sm">
      <div className="flex items-center justify-between px-3 py-1 bg-white/2 border-b border-border/40">
        <span className="text-[11px] text-foreground/30 font-mono">{language || 'text'}</span>
        <Button variant="ghost-muted" size="xs" onClick={copy} className="font-normal gap-1 h-5 text-[11px]">
          {copied ? <VscCheck className="size-3 text-emerald-400" /> : <VscCopy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={warmCode}
        showLineNumbers={true}
        customStyle={{ margin: 0, borderRadius: 0, background: 'transparent', fontSize: '12px', padding: '0.75rem 0' }}
        wrapLines={true}
        wrapLongLines={true}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
        lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1em', color: 'rgba(247,237,226,0.18)', textAlign: 'right', userSelect: 'none' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
});

const mdComponents: any = {
  pre({ children, ...props }: any) {
    const codeElement = children;
    const isCode = codeElement?.type === 'code';
    const className = codeElement?.props?.className || '';
    const match = /language-(\w+)/.exec(className);
    if (isCode || match) return <CodeBlock language={match ? match[1] : 'text'}>{String(codeElement?.props?.children || '').replace(/\n$/, '')}</CodeBlock>;
    return <pre {...props}>{children}</pre>;
  },
  code({ className, children, ...props }: any) { return <code className={className} {...props}>{children}</code>; },
};

export const Markdown = memo(function Markdown({ text, className = "prose prose-chat min-w-0 select-text" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
