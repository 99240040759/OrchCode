import { Children, isValidElement, memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LuArrowUpRight, LuCheck, LuCopy } from "react-icons/lu";
import { createMentionRegex, looksLikePath, useCopy } from "../../lib/utils";
import { useImageDataUrl } from "../../lib/images";
import { FileChip } from "../common/FileChip";
import { Button, IconButton } from "../ui/Button";
import { useArtifactsStore } from "../../lib/artifacts";
import { getGrammar, highlight } from "./highlight";

export function renderTextWithMentions(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  const regex = createMentionRegex();
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const path = match[1] ?? match[3] ?? "";
    const lineRange = match[2] ?? match[4] ?? "";
    if (!looksLikePath(path)) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<FileChip key={match.index} path={path} lineRange={lineRange || undefined} />);
    last = match.index + match[0].length;
  }

  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function isWorkspaceLink(href: string): boolean {
  if (href.startsWith("file:")) return true;
  if (href.startsWith("#") || href.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return false;
  if (/^www\./i.test(href) || /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|edu|gov)(\/|$)/i.test(href)) return false;
  return /\.[a-zA-Z0-9]+(?:#L\d+(?:-\d+)?)?$/.test(href);
}

function parseWorkspaceHref(href: string): { path: string; lineRange?: string } {
  let raw = href;
  if (raw.startsWith("file://")) {
    raw = raw.slice(7);
    if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1);
  } else if (raw.startsWith("file:")) {
    raw = raw.slice(5);
  }
  const lineMatch = /(#L\d+(?:-\d+)?)$/.exec(raw);
  const bare = lineMatch ? raw.slice(0, lineMatch.index) : raw;
  try {
    return { path: decodeURIComponent(bare), lineRange: lineMatch?.[1] };
  } catch {
    return { path: bare, lineRange: lineMatch?.[1] };
  }
}

function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { copied, copy } = useCopy(code, 1500);
  const grammar = useMemo(() => (lang ? getGrammar(lang) : null), [lang]);
  const content = useMemo(() => (grammar && code ? highlight(code, grammar) : code), [code, grammar]);

  return (
    <div className="code">
      <div className="code-head">
        <span>{lang || "code"}</span>
        <IconButton label={copied ? "Copied" : "Copy code"} side="top" size="sm" onClick={copy}>
          {copied ? <LuCheck /> : <LuCopy />}
        </IconButton>
      </div>
      <pre className="selectable">
        <code>{content}</code>
      </pre>
    </div>
  );
});

function WorkspaceImage({ src, alt }: { src: string; alt?: string }) {
  const isData = src.startsWith("data:");
  const loaded = useImageDataUrl(isData ? null : parseWorkspaceHref(src).path);
  const url = isData ? src : loaded.src;
  return (
    <span className="media">
      {url && <img src={url} alt={alt ?? ""} loading="lazy" />}
      {(!url || alt) && <span>{url ? alt : loaded.loading ? "Loading image…" : alt || src}</span>}
    </span>
  );
}

const COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="table">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => {
    const child = Children.toArray(children)[0];
    const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
    const lang = /language-([a-zA-Z0-9_+-]+)/.exec(className)?.[1]?.toLowerCase() ?? "";
    return <CodeBlock lang={lang} code={nodeText(children).replace(/\n$/, "")} />;
  },
  code: ({ node: _node, ...props }) => <code {...props} />,
  a: ({ node: _node, href, children, ...props }) => {
    const link = href ?? "";
    if (!link) return <a {...props}>{children}</a>;
    if (isWorkspaceLink(link)) {
      const { path, lineRange } = parseWorkspaceHref(link);
      const label = nodeText(children).trim();
      if (label && looksLikePath(path)) return <FileChip path={path} name={label} lineRange={lineRange} />;
      return (
        <a
          {...props}
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
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
        onClick={(e) => {
          e.preventDefault();
          void openUrl(link);
        }}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const source = typeof src === "string" ? src : "";
    if (!source) return null;
    if (/^https?:/i.test(source)) {
      return (
        <Button variant="subtle" size="sm" title={source} onClick={() => void openUrl(source)}>
          <span>{alt || "Remote image"}</span>
          <LuArrowUpRight />
        </Button>
      );
    }
    return <WorkspaceImage src={source} alt={alt} />;
  },
};

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [rehypeKatex];

function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence = false;
  const flush = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };

  for (const line of text.split("\n")) {
    if (line.startsWith("```") || line.startsWith("~~~")) {
      if (!fence) flush();
      fence = !fence;
      current.push(line);
      if (!fence) flush();
      continue;
    }
    if (!fence && /^#{1,6}\s/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    if (!fence && line.trim() === "") {
      if (!current.length) continue;
      if (!/^\s*([-*+]|\d+[.)])\s/.test(current[0])) {
        flush();
        continue;
      }
    }
    current.push(line);
  }
  flush();
  return blocks.length ? blocks : [text];
}

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const blocks = useMemo(() => (children?.trim() ? splitBlocks(children) : []), [children]);
  if (!blocks.length) return null;
  return (
    <div className="prose selectable">
      {blocks.map((block, i) => (
        <Block key={i} text={block} />
      ))}
    </div>
  );
});
