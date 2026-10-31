import React, { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getPrismGrammar, tokenizeToLines } from "./Markdown";
import * as utils from "../lib/utils";

const EXT_TO_LANG: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  htm: "markup",
  html: "markup",
  xml: "markup",
  vue: "markup",
  svelte: "markup",
  scss: "css",
  sass: "css",
  less: "css",
  kt: "java",
  gql: "graphql",
  hcl: "hcl",
  tf: "hcl",
  mdx: "markdown",
  markdown: "markdown",
};

function langFromPath(path: string): string {
  const base = utils.getBasename(path).toLowerCase();
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "bash";
  const ext = utils.getExt(path);
  return EXT_TO_LANG[ext] ?? ext;
}

interface CodeViewerProps {
  path: string;
  content: string;
}

export const CodeViewer = React.memo(function CodeViewer({ path, content }: CodeViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lang = useMemo(() => langFromPath(path), [path]);

  const lines = useMemo(() => {
    const parsed = getPrismGrammar(lang);
    return tokenizeToLines(content, parsed?.grammar ?? null);
  }, [content, lang]);

  const gutterWidth = Math.max(2, String(lines.length).length);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 24,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="CodeViewer"
      style={{ ["--gutter-ch" as string]: gutterWidth }}
    >
      <pre
        className="CodeViewer-pre"
        aria-label={`Source of ${utils.getBasename(path)}`}
        style={{ height: virtualizer.getTotalSize() + 24 }}
      >
        <code className={`language-${lang}`}>
          {virtualItems.map((virtualRow) => {
            const nodes = lines[virtualRow.index];
            return (
              <span
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="CodeViewer-line"
                style={{
                  transform: `translateY(${virtualRow.start + 12}px)`,
                }}
              >
                <span className="CodeViewer-ln" aria-hidden="true">
                  {virtualRow.index + 1}
                </span>
                <span className="CodeViewer-code">
                  {nodes && nodes.length > 0 ? nodes : "\n"}
                </span>
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
});
