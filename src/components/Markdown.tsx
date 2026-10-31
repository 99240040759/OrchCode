import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
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

import { looksLikePath, createMentionRegex, useCopy } from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import { useImageDataUrl } from "../lib/images";
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
    const path = match[1] ?? match[3] ?? "";
    const lineRange = match[2] ?? match[4] ?? "";
    if (!looksLikePath(path)) continue;
    matched = true;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <FileTag key={`mention-${match.index}`} path={path} lineRange={lineRange || undefined} />
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

function parseWorkspaceHref(href: string): { path: string; lineRange?: string } {
  let raw = href;
  if (raw.startsWith("file://")) {
    raw = raw.slice(7);
    if (/^\/[a-zA-Z]:\//.test(raw)) {
      raw = raw.slice(1);
    }
  } else if (raw.startsWith("file:")) {
    raw = raw.slice(5);
  }
  const lineMatch = /(#L\d+(?:-\d+)?)$/.exec(raw);
  const lineRange = lineMatch ? lineMatch[1] : undefined;
  const withoutFragment = lineMatch ? raw.slice(0, lineMatch.index) : raw;
  try {
    return { path: decodeURIComponent(withoutFragment), lineRange };
  } catch {
    return { path: withoutFragment, lineRange };
  }
}

const PRISM_ALIASES: Record<string, string> = {
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

export function getPrismGrammar(lang: string): { grammar: Prism.Grammar; name: string } | null {
  const target = PRISM_ALIASES[lang] ?? lang;
  const grammar = Prism.languages[target];
  return grammar ? { grammar, name: target } : null;
}

export function renderToken(token: Prism.Token | string, key: string): React.ReactNode {
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

export function tokenizeToLines(code: string, grammar: Prism.Grammar | null): React.ReactNode[][] {
  const rawLines = code.split("\n");
  if (!grammar || code.length === 0) {
    return rawLines.map((line) => (line.length > 0 ? [line] : []));
  }
  const lines: React.ReactNode[][] = [[]];
  let keyCounter = 0;

  const appendToken = (token: Prism.Token | string, wrapperClass?: string) => {
    if (typeof token === "string") {
      const parts = token.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) lines.push([]);
        const part = parts[i];
        if (part.length > 0) {
          const currentLine = lines[lines.length - 1];
          if (wrapperClass) {
            currentLine.push(
              <span key={`t-${++keyCounter}`} className={wrapperClass}>
                {part}
              </span>
            );
          } else {
            currentLine.push(part);
          }
        }
      }
      return;
    }

    const aliases = token.alias
      ? Array.isArray(token.alias)
        ? token.alias.join(" ")
        : token.alias
      : "";
    const tokenClass = `token ${token.type} ${aliases}`.trim();
    const combinedClass = wrapperClass ? `${wrapperClass} ${tokenClass}` : tokenClass;

    if (Array.isArray(token.content)) {
      for (const child of token.content) {
        appendToken(child, combinedClass);
      }
    } else {
      appendToken(token.content as Prism.Token | string, combinedClass);
    }
  };

  const tokens = Prism.tokenize(code, grammar);
  for (const token of tokens) {
    appendToken(token);
  }
  return lines;
}

function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

const CodeBlock = React.memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { copied, copy } = useCopy(code, 1500);
  const parsed = useMemo(() => (lang ? getPrismGrammar(lang) : null), [lang]);
  const tokens = useMemo(
    () => (parsed && code ? Prism.tokenize(code, parsed.grammar).map((t, i) => renderToken(t, `tok-${i}`)) : null),
    [code, parsed]
  );

  return (
    <div className="CodeBlock">
      <div className="CodeBlock-header">
        <span className="CodeBlock-lang">{lang ? lang.toLowerCase() : "code"}</span>
        <Tooltip content={copied ? "Copied" : "Copy code"} side="top">
          <button type="button" className="CodeBlock-copy" onClick={copy} aria-label="Copy code">
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
        {tokens ? <code className={`language-${parsed?.name ?? "text"}`}>{tokens}</code> : <code>{code}</code>}
      </pre>
    </div>
  );
});

function WorkspaceImage({ src, alt }: { src: string; alt?: string }) {
  const isData = src.startsWith("data:");
  const loaded = useImageDataUrl(isData ? null : parseWorkspaceHref(src).path);
  const url = isData ? src : loaded.src;
  if (!url) {
    return (
      <span className="Markdown-imgCard">
        <span className="Markdown-imgCaption">{loaded.loading ? "Loading image…" : alt || src}</span>
      </span>
    );
  }
  return (
    <span className="Markdown-imgCard">
      <img src={url} alt={alt ?? ""} className="Markdown-imgThumb" loading="lazy" />
      {alt && <span className="Markdown-imgCaption">{alt}</span>}
    </span>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  table({ children, ...props }) {
    return (
      <div className="Markdown-tableWrap">
        <table {...props}>{children}</table>
      </div>
    );
  },
  pre({ children }) {
    const child = React.Children.toArray(children)[0];
    const className = React.isValidElement<{ className?: string }>(child) ? child.props.className ?? "" : "";
    const lang = /language-([a-zA-Z0-9_+-]+)/.exec(className)?.[1]?.toLowerCase() ?? "";
    return <CodeBlock lang={lang} code={nodeText(children).replace(/\n$/, "")} />;
  },
  code({ node: _node, ...props }) {
    return <code {...props} />;
  },
  a({ node: _node, href, children, ...props }) {
    const link = href ?? "";
    if (!link) return <a {...props}>{children}</a>;
    if (isWorkspaceLink(link)) {
      const { path, lineRange } = parseWorkspaceHref(link);
      const label = nodeText(children).trim();
      if (label && looksLikePath(path)) {
        return <FileTag path={path} name={label} lineRange={lineRange} />;
      }
      return (
        <a
          {...props}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.preventDefault();
            useArtifactsStore.getState().openFile(path);
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a
        {...props}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          void openUrl(link);
        }}
      >
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const source = typeof src === "string" ? src : "";
    if (!source) return null;
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
    return <WorkspaceImage src={source} alt={alt} />;
  },
};

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (line.startsWith("```") || line.startsWith("~~~")) {
      if (!inCode && current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      inCode = !inCode;
      current.push(line);
      if (!inCode) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    if (!inCode) {
      if (line.trim() === "") {
        if (current.length > 0) {
          blocks.push(current.join("\n"));
          current = [];
        }
        continue;
      }
      if (/^#{1,6}\s/.test(line)) {
        if (current.length > 0) {
          blocks.push(current.join("\n"));
          current = [];
        }
        blocks.push(line);
        continue;
      }
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks.length > 0 ? blocks : [text];
}

const MarkdownBlock = React.memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = React.memo(function Markdown({ children }: { children: string }) {
  const blocks = useMemo(() => (children && children.trim() ? splitBlocks(children) : []), [children]);
  if (blocks.length === 0) return null;
  return (
    <div className="Markdown">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} text={block} />
      ))}
    </div>
  );
});
