import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { createMentionRegex, isImagePath } from "../lib/utils";
import FileTag from "./FileTag";
import CodeBlock from "./ui/CodeBlock";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function looksLikePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-zA-Z0-9]+$/.test(value);
}

function hasScheme(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
}

function isWorkspaceLink(href: string): boolean {
  if (hasScheme(href)) return href.startsWith("file:");
  if (href.startsWith("#") || href.startsWith("//")) return false;
  return /\.[a-zA-Z0-9]+(?:#L\d+(?:-\d+)?)?$/.test(href);
}

export function renderTextWithMentions(text: string): React.ReactNode {
  if (!text) return text;

  const regex = createMentionRegex();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matched = false;

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

function withMentions(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) =>
    typeof child === "string" ? renderTextWithMentions(child) : child
  );
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (hasScheme(src) && !src.startsWith("file:")) {
      setResolved(src);
      return;
    }
    const path = src.replace(/^file:\/\/\/?/, "");
    if (!isImagePath(path)) {
      setResolved(null);
      return;
    }
    let active = true;
    api
      .readImageDataUrl(path)
      .then((url) => {
        if (active) setResolved(url);
      })
      .catch(() => {
        if (active) setResolved(null);
      });
    return () => {
      active = false;
    };
  }, [src]);

  if (!resolved) return <FileTag path={src.replace(/^file:\/\/\/?/, "")} />;

  return (
    <span className="Markdown-imgCard" title={src}>
      <img src={resolved} alt={alt} className="Markdown-imgThumb" />
      {alt && <span className="Markdown-imgCaption">{alt}</span>}
    </span>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="Markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img({ src, alt }) {
            if (typeof src !== "string" || !src) return null;
            return <MarkdownImage src={src} alt={alt ?? ""} />;
          },
          pre({ children: preChildren }) {
            const child = Array.isArray(preChildren) ? preChildren[0] : preChildren;
            if (!React.isValidElement(child)) return <pre>{preChildren}</pre>;
            const props = child.props as { className?: string; children?: React.ReactNode };
            const match = /language-([\w+-]+)/.exec(props.className ?? "");
            const value = extractText(props.children).replace(/\n$/, "");
            return <CodeBlock language={match ? match[1] : "text"} value={value} />;
          },
          code({ children: codeChildren }) {
            return <code className="Markdown-inlinecode">{codeChildren}</code>;
          },
          p({ children: pChildren }) {
            return <p>{withMentions(pChildren)}</p>;
          },
          li({ children: liChildren }) {
            return <li>{withMentions(liChildren)}</li>;
          },
          table({ children: tableChildren }) {
            return (
              <div className="Markdown-tableWrapper">
                <table>{tableChildren}</table>
              </div>
            );
          },
          a({ href, children: aChildren }) {
            const target = href ?? "";
            if (isWorkspaceLink(target)) {
              const clean = target.replace(/^file:\/\/\/?/, "");
              const lineMatch = /#L\d+(?:-\d+)?$/.exec(clean);
              return (
                <FileTag
                  path={clean.replace(/#L\d+(?:-\d+)?$/, "")}
                  lineRange={lineMatch ? lineMatch[0] : undefined}
                />
              );
            }
            return (
              <a
                href={target}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  if (target) void openUrl(target);
                }}
              >
                {aChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default Markdown;
