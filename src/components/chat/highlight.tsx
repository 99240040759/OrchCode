import type { ReactNode } from "react";
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

const ALIASES: Record<string, string> = {
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

export function getGrammar(lang: string): Prism.Grammar | null {
  return Prism.languages[ALIASES[lang] ?? lang] ?? null;
}

function tokenClass(token: Prism.Token, parent?: string): string {
  const alias = Array.isArray(token.alias) ? token.alias.join(" ") : (token.alias ?? "");
  const own = `token ${token.type} ${alias}`.trim();
  return parent ? `${parent} ${own}` : own;
}

export function highlight(code: string, grammar: Prism.Grammar): ReactNode[] {
  let key = 0;
  const render = (token: Prism.Token | string): ReactNode => {
    if (typeof token === "string") return token;
    const content = Array.isArray(token.content)
      ? token.content.map(render)
      : render(token.content as Prism.Token | string);
    return (
      <span key={key++} className={tokenClass(token)}>
        {content}
      </span>
    );
  };
  return Prism.tokenize(code, grammar).map(render);
}

export function highlightLines(code: string, grammar: Prism.Grammar | null): ReactNode[][] {
  if (!grammar || !code) return code.split("\n").map((line) => (line ? [line] : []));
  const lines: ReactNode[][] = [[]];
  let key = 0;

  const append = (token: Prism.Token | string, className?: string) => {
    if (typeof token === "string") {
      token.split("\n").forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (!part) return;
        lines[lines.length - 1].push(
          className ? (
            <span key={key++} className={className}>
              {part}
            </span>
          ) : (
            part
          )
        );
      });
      return;
    }
    const next = tokenClass(token, className);
    if (Array.isArray(token.content)) token.content.forEach((child) => append(child, next));
    else append(token.content as Prism.Token | string, next);
  };

  Prism.tokenize(code, grammar).forEach((token) => append(token));
  return lines;
}
