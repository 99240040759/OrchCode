import { useState } from "react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { VscCopy, VscCheck } from "react-icons/vsc";
import { Button } from "@/components/ui/button";

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="relative group my-4 rounded-md overflow-hidden bg-card border border-border/45 shadow-sm">
      <div className="flex items-center justify-between px-3 py-1 bg-muted/20 border-b border-border/45">
        <span className="text-xs text-muted-foreground font-mono">{language || 'text'}</span>
        <Button variant="ghost-muted" size="sidebar-item" onClick={copy} className="font-normal gap-1.5">
          {copied ? <VscCheck className="size-3.5 text-green-400" /> : <VscCopy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <SyntaxHighlighter 
        language={language || 'text'} 
        style={vscDarkPlus} 
        showLineNumbers={true}
        customStyle={{ margin: 0, borderRadius: 0, background: 'transparent', fontSize: '13px', padding: '1rem 0' }}
        wrapLines={true}
        wrapLongLines={true}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
        lineNumberStyle={{ minWidth: '3em', paddingRight: '1em', color: 'hsl(0 0% 40%)', textAlign: 'right' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

const mdComponents: any = {
  pre({ children, ...props }: any) {
    const codeElement = children;
    const className = codeElement?.props?.className;
    const match = /language-(\w+)/.exec(className || '');
    if (match) {
      return <CodeBlock language={match[1]}>{String(codeElement.props.children).replace(/\n$/, '')}</CodeBlock>;
    }
    return <pre {...props}>{children}</pre>;
  },
  code({ className, children, ...props }: any) {
    return <code className={className} {...props}>{children}</code>;
  },
};

export function Markdown({ text, className = "prose prose-chat min-w-0 prose-headings:text-base" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
