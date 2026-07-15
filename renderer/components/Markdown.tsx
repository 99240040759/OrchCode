import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TbCopy, TbCheck } from 'react-icons/tb'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { toast } from '../lib/toast'

interface MarkdownProps {
  content: string
}

export function CodeBlock({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const match = className ? /language-(\w+)/.exec(className) : undefined
  const lang = match ? match[1] : 'code'
  const code = String(children).replace(/\n$/, '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (err: unknown) {
      toast.error('Failed to copy code to clipboard.', err)
    }
  }
  return (
    <div className="border border-oc-border rounded-md overflow-hidden bg-oc-surface font-mono text-xs shadow-md mt-4 mb-4 last:mb-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-oc-base border-b border-oc-border text-tx-sub select-none">
        <span className="font-semibold text-3xs uppercase tracking-wider">{lang}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 text-3xs hover:text-tx-bright transition-colors cursor-pointer bg-transparent border-none outline-none"
        >
          {copied ? <TbCheck size={13} className="text-tx-bright" /> : <TbCopy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        wrapLongLines={true}
        customStyle={{ margin: 0, padding: 0, background: 'transparent' }}
        codeTagProps={{ style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }}
        className="!m-0 !bg-oc-surface overflow-x-hidden !p-4 text-[13px] leading-relaxed"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export function Markdown({ content }: MarkdownProps): React.JSX.Element {
  return (
    <div className="text-base text-tx-main leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          a: ({ ...props }) => (
            <a
              {...props}
              className="text-tx-bright underline hover:text-tx-bright transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            />
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = !!className?.startsWith('language-') || String(children).includes('\n')
            return isBlock ? (
              <CodeBlock className={className} {...props}>
                {children}
              </CodeBlock>
            ) : (
              <code
                className="bg-oc-raised border border-oc-border px-1.5 py-0.5 rounded text-sm font-mono text-tx-muted"
                {...props}
              >
                {children}
              </code>
            )
          },
          ul: ({ ...props }) => <ul {...props} className="list-disc pl-5 mt-4 mb-4 space-y-1.5 last:mb-0" />,
          ol: ({ ...props }) => <ol {...props} className="list-decimal pl-5 mt-4 mb-4 space-y-1.5 last:mb-0" />,
          li: ({ ...props }) => <li {...props} className="my-0.5" />,
          table: ({ ...props }) => (
            <div className="overflow-x-auto border border-oc-border rounded-md bg-oc-surface shadow-md mt-4 mb-4 last:mb-0">
              <table {...props} className="min-w-full text-xs" />
            </div>
          ),
          thead: ({ ...props }) => <thead {...props} className="bg-oc-base border-b border-oc-border" />,
          th: ({ ...props }) => (
            <th
              {...props}
              className="px-3.5 py-2 text-left font-semibold text-tx-bright uppercase tracking-wider text-3xs select-none"
            />
          ),
          td: ({ ...props }) => (
            <td
              {...props}
              className="px-3.5 py-2 border-t border-oc-border text-tx-main font-mono text-2xs"
            />
          ),
          h1: ({ ...props }) => <h1 {...props} className="font-bold text-tx-bright text-xl mt-6 mb-4 last:mb-0" />,
          h2: ({ ...props }) => <h2 {...props} className="font-bold text-tx-bright text-lg mt-5 mb-3 last:mb-0" />,
          h3: ({ ...props }) => <h3 {...props} className="font-bold text-tx-bright text-base mt-4 mb-2 last:mb-0" />,
          p: ({ ...props }) => <p {...props} className="mb-4 last:mb-0" />,
          hr: ({ ...props }) => <hr {...props} className="mt-4 mb-4 border-t border-oc-border/60 last:mb-0" />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
