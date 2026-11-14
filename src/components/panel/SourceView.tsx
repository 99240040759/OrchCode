import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getBasename, getExt } from "../../lib/utils";
import { getGrammar, highlightLines } from "../chat/highlight";

const LINE_HEIGHT = 20;
const PAD = 12;

const EXT_LANG: Record<string, string> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
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
  tf: "hcl",
  mdx: "markdown",
};

function languageFor(path: string): string {
  const base = getBasename(path).toLowerCase();
  if (base === "dockerfile") return "docker";
  if (base === "makefile") return "bash";
  const ext = getExt(path);
  return EXT_LANG[ext] ?? ext;
}

export const SourceView = memo(function SourceView({ path, content }: { path: string; content: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => highlightLines(content, getGrammar(languageFor(path))), [content, path]);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: 24,
    paddingStart: PAD,
    paddingEnd: PAD,
  });

  return (
    <div ref={scrollRef} className="source selectable" style={{ ["--gutter" as string]: String(lines.length).length }}>
      <pre aria-label={`Source of ${getBasename(path)}`} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div key={row.key} className="source-line" style={{ transform: `translate3d(0, ${row.start}px, 0)` }}>
            <span className="source-ln" aria-hidden="true">
              {row.index + 1}
            </span>
            <code className="source-code">{lines[row.index]?.length ? lines[row.index] : "\n"}</code>
          </div>
        ))}
      </pre>
    </div>
  );
});
