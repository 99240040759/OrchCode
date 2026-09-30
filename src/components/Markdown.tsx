import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { VscCheck, VscCopy } from "react-icons/vsc";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-ruby";

import { looksLikePath, createMentionRegex } from "../lib/api";
import { useArtifactsStore } from "../lib/artifacts";
import { FileTag } from "./ChatPrimitives";
import { Tooltip } from "./ui/Tooltip";

export function renderTextWithMentions(text: string): React.ReactNode {
  if (!text) return text;

  const parts: React.ReactNode[] = [];
  const regex = createMentionRegex();
  let lastIndex = 0;
  let matched = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const path = match[1] ?? match[2] ?? "";
    if (!looksLikePath(path)) continue;
    matched = true;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <FileTag key={`mention-${match.index}`} path={path} lineRange={match[3] ?? undefined} />
    );
    lastIndex = match.index + match[0].length;
  }

  if (!matched) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

function isWorkspaceLink(href: string): boolean {
  if (href.startsWith("file:")) return true;
  if (href.startsWith("#") || href.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    return false;
  }
  if (/^www\./i.test(href) || /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|edu|gov)(\/|$)/i.test(href)) {
    return false;
  }
  return /\.[a-zA-Z0-9]+(?:#L\d+(?:-\d+)?)?$/.test(href);
}

function workspacePathFromHref(href: string): string {
  const withoutScheme = href.startsWith("file:") ? href.replace(/^file:\/*/, "") : href;
  const withoutFragment = withoutScheme.replace(/#L\d+(?:-\d+)?$/, "");
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function getPrismGrammar(lang: string): { grammar: Prism.Grammar; name: string } | null {
  const norm = lang.toLowerCase();
  const aliasMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    cs: "csharp",
    "c++": "cpp",
    rb: "ruby",
    dockerfile: "docker",
    golang: "go",
  };
  const target = aliasMap[norm] || norm;
  const grammar = Prism.languages[target];
  return grammar ? { grammar, name: target } : null;
}

function renderToken(token: Prism.Token | string, key: string): React.ReactNode {
  if (typeof token === "string") return token;
  const aliases = token.alias
    ? Array.isArray(token.alias) ? token.alias.join(" ") : token.alias
    : "";
  const tokenClass = `token ${token.type} ${aliases}`.trim();
  return (
    <span key={key} className={tokenClass}>
      {Array.isArray(token.content)
        ? token.content.map((t, i) => renderToken(t, `${key}-${i}`))
        : renderToken(token.content as Prism.Token | string, `${key}-content`)}
    </span>
  );
}

const CodeBlockComponent = React.memo(function CodeBlockComponent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const match = /language-([a-zA-Z0-9_-]+)/.exec(className || "");
  const rawLang = match ? match[1].toLowerCase() : "";
  const codeString = String(children || "").replace(/\n$/, "");
  const isInline = !match && !codeString.includes("\n");

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const parsed = useMemo(() => (rawLang ? getPrismGrammar(rawLang) : null), [rawLang]);

  const renderedTokens = useMemo(() => {
    if (!parsed || !codeString) return null;
    return Prism.tokenize(codeString, parsed.grammar).map((t, i) =>
      renderToken(t, `tok-${i}`)
    );
  }, [codeString, parsed]);

  if (isInline) {
    return <code className={className}>{children}</code>;
  }

  return (
    <div className="CodeBlock">
      <div className="CodeBlock-header">
        <span className="CodeBlock-lang">{rawLang || "text"}</span>
        <Tooltip content={copied ? "Copied" : "Copy code"} side="top">
          <button
            type="button"
            className="CodeBlock-copy"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <VscCheck className="CodeBlock-copyIconDone" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <VscCopy />
                <span>Copy</span>
              </>
            )}
          </button>
        </Tooltip>
      </div>
      <pre className="CodeBlock-pre">
        {renderedTokens ? (
          <code className={`language-${parsed?.name || "text"}`}>{renderedTokens}</code>
        ) : (
          <code>{codeString}</code>
        )}
      </pre>
    </div>
  );
});

function splitMarkdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (trimmed.startsWith(fence)) fence = null;
    }
    current.push(line);
    if (fence === null && line.trim() === "" && current.some((l) => l.trim() !== "")) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

export const Markdown = React.memo(function Markdown({ children }: { children: string }) {
  if (!children) return null;
  if (children.length < 4000) {
    return (
      <div className="Markdown">
        <MarkdownBlock text={children} />
      </div>
    );
  }
  const blocks = splitMarkdownBlocks(children);
  return (
    <div className="Markdown">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} text={block} />
      ))}
    </div>
  );
});

const MarkdownBlock = React.memo(function MarkdownBlock({ text }: { text: string }) {
  const openFile = useArtifactsStore((s) => s.openFile);
  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children: preChildren }) {
            return <>{preChildren}</>;
          },
          code({ className: codeClass, children: codeChildren }) {
            return (
              <CodeBlockComponent className={codeClass}>
                {codeChildren}
              </CodeBlockComponent>
            );
          },
          a({ href, children: aChildren, ...props }) {
            const link = href || "";
            if (link && isWorkspaceLink(link)) {
              const path = workspacePathFromHref(link);
              return (
                <a
                  href={link}
                  onClick={(e) => {
                    e.preventDefault();
                    openFile(path);
                  }}
                  {...props}
                >
                  {aChildren}
                </a>
              );
            }
            if (link) {
              return (
                <a
                  href={link}
                  onClick={(e) => {
                    e.preventDefault();
                    void openUrl(link);
                  }}
                  target="_blank"
                  rel="noreferrer"
                  {...props}
                >
                  {aChildren}
                </a>
              );
            }
            return <a href={link} {...props}>{aChildren}</a>;
          },
          img({ src, alt, ...props }) {
            const source = typeof src === "string" ? src : "";
            if (/^https?:/i.test(source)) {
              return (
                <button
                  type="button"
                  className="Markdown-remoteImg"
                  title={source}
                  onClick={() => void openUrl(source)}
                >
                  {alt || "Remote image"} ↗
                </button>
              );
            }
            return (
              <div className="Markdown-imgCard">
                <img src={src} alt={alt} className="Markdown-imgThumb" loading="lazy" {...props} />
                {alt && <span className="Markdown-imgCaption">{alt}</span>}
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </>
  );
});
