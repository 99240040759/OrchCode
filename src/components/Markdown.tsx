import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
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

import { looksLikePath, createMentionRegex, useCopy } from "../lib/api";
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

function getPrismGrammar(lang: string): { grammar: Prism.Grammar; name: string } | null {
  const target = PRISM_ALIASES[lang] ?? lang;
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
        <span className="CodeBlock-lang">{lang || "text"}</span>
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
  const loaded = useImageDataUrl(isData ? null : workspacePathFromHref(src));
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
      return (
        <a
          {...props}
          href={link}
          onClick={(event) => {
            event.preventDefault();
            useArtifactsStore.getState().openFile(workspacePathFromHref(link));
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a
        {...props}
        href={link}
        rel="noreferrer"
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

const REMARK_PLUGINS = [remarkGfm];

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

const MarkdownBlock = React.memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = React.memo(function Markdown({ children }: { children: string }) {
  if (!children) return null;
  if (children.length < 4000) {
    return (
      <div className="Markdown">
        <MarkdownBlock text={children} />
      </div>
    );
  }
  return (
    <div className="Markdown">
      {splitMarkdownBlocks(children).map((block, index) => (
        <MarkdownBlock key={index} text={block} />
      ))}
    </div>
  );
});
