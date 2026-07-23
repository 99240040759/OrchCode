import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { inTauri } from "../lib/api";
import { createMentionRegex } from "../lib/utils";
import FileTag from "./FileTag";
import ExplorerIcon from "./ExplorerIcon";
import CodeBlock from "./ui/CodeBlock";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children);
  return "";
}

const ATTACHMENT_RE = /\[Attached (image|file):\s*([^—\n]+?)\s*—\s*([^\]\n]+)\]/g;

export function renderTextWithMentions(text: string): React.ReactNode {
  if (!text) return text;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  const combinedRegex = new RegExp(`(?:${createMentionRegex().source})|(?:${ATTACHMENT_RE.source})`, "g");
  let match: RegExpExecArray | null;

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    if (match[1]) {
      parts.push(<FileTag key={`mention-${match.index}`} path={match[1]} lineRange={match[2]} />);
    } else if (match[3] && match[4] && match[5]) {
      const isImg = match[3] === "image";
      const name = match[4].trim();
      const path = match[5].trim();
      const imgSrc = isImg && inTauri() ? convertFileSrc(path) : `file://${path}`;
      if (isImg) {
        parts.push(
          <span key={`attach-${match.index}`} className="AttachmentCard AttachmentCard-image" title={path}>
            <span className="AttachmentCard-thumbWrap">
              <img src={imgSrc} alt={name} className="AttachmentCard-thumb" onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }} />
            </span>
            <span className="AttachmentCard-name">{name}</span>
          </span>
        );
      } else {
        parts.push(
          <span key={`attach-${match.index}`} className="AttachmentCard AttachmentCard-doc" title={path}>
            <ExplorerIcon type="file" name={name} className="AttachmentCard-icon" style={{ width: 15, height: 15, flexShrink: 0 }} />
            <span className="AttachmentCard-name">{name}</span>
          </span>
        );
      }
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx === 0) return text;
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}

const FILE_LINK_RE = /\.[a-zA-Z0-9]+(#L\d+)?$/;

export function Markdown({ children }: { children: string }) {
  return (
    <div className="Markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img({ src, alt }) {
            if (!src) return null;
            const isLocal = src.startsWith("file://") || src.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(src);
            const cleanPath = src.replace(/^file:\/\/\/?/, "");
            const resolvedSrc = isLocal && inTauri() ? convertFileSrc(cleanPath) : src;
            return (
              <span className="Markdown-imgCard" title={src}>
                <img src={resolvedSrc} alt={alt ?? ""} className="Markdown-imgThumb" />
                {alt && <span className="Markdown-imgCaption">{alt}</span>}
              </span>
            );
          },
          code({ className, children: codeChildren }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const value = extractText(codeChildren).replace(/\n$/, "");
            if (match) return <CodeBlock language={match[1]} value={value} />;
            return <code className="Markdown-inlinecode">{codeChildren}</code>;
          },
          p({ children: pChildren }) {
            return <p>{React.Children.map(pChildren, (child) => (typeof child === "string" ? renderTextWithMentions(child) : child))}</p>;
          },
          li({ children: liChildren }) {
            return <li>{React.Children.map(liChildren, (child) => (typeof child === "string" ? renderTextWithMentions(child) : child))}</li>;
          },
          table({ children: tableChildren }) {
            return <div className="Markdown-tableWrapper"><table>{tableChildren}</table></div>;
          },
          a({ href, children: aChildren }) {
            const linkText = extractText(aChildren);
            const isFileLink = href?.startsWith("file://") || FILE_LINK_RE.test(href ?? "") || FILE_LINK_RE.test(linkText);
            if (isFileLink) {
              const cleanPath = href?.replace(/^file:\/\/\/?/, "") || linkText;
              const lineMatch = /#L\d+(?:-\d+)?/.exec(cleanPath);
              const lineRange = lineMatch ? lineMatch[0] : undefined;
              const basePath = cleanPath.replace(/#L\d+(?:-\d+)?$/, "");
              return <FileTag path={basePath} lineRange={lineRange} />;
            }
            const handleClick = (e: React.MouseEvent) => {
              if (href && inTauri()) { e.preventDefault(); void openUrl(href); }
            };
            return <a href={href} target="_blank" rel="noreferrer" onClick={handleClick}>{aChildren}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
