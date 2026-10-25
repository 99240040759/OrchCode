import React, { useMemo } from "react";
import Prism from "prismjs";
import { getPrismGrammar, renderToken } from "./Markdown";
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
  const lang = useMemo(() => langFromPath(path), [path]);

  const lines = useMemo(() => {
    const grammar = getPrismGrammar(lang);
    const rawLines = content.split("\n");
    return rawLines.map((line, index) => {
      if (!grammar || line.length === 0) {
        return { key: index, nodes: line as React.ReactNode };
      }
      const tokens = Prism.tokenize(line, grammar.grammar);
      return {
        key: index,
        nodes: tokens.map((t, i) => renderToken(t, `l${index}-t${i}`)),
      };
    });
  }, [content, lang]);

  const gutterWidth = String(lines.length).length;

  return (
    <div
      className="CodeViewer"
      style={{ ["--gutter-ch" as string]: gutterWidth }}
    >
      <pre className="CodeViewer-pre" aria-label={`Source of ${utils.getBasename(path)}`}>
        <code className={`language-${lang}`}>
          {lines.map((line) => (
            <span className="CodeViewer-line" key={line.key}>
              <span className="CodeViewer-ln" aria-hidden="true">
                {line.key + 1}
              </span>
              <span className="CodeViewer-code">{line.nodes}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});
