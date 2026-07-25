import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { createHighlighterCore, createJavaScriptRegexEngine } from "shiki/core";
import type { HighlighterCore, LanguageInput } from "shiki";

const THEME = "vitesse-dark";
const BUILTIN_PLAIN = "text";
const HIGHLIGHT_DEBOUNCE_MS = 60;

const LANG_ALIAS: Record<string, string> = {
  txt: BUILTIN_PLAIN,
  plaintext: BUILTIN_PLAIN,
  plain: BUILTIN_PLAIN,
  log: BUILTIN_PLAIN,
  rs: "rust",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  js: "javascript",
  ts: "typescript",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  cs: "csharp",
  rb: "ruby",
  kt: "kotlin",
  docker: "dockerfile",
  ps1: "powershell",
  less: "css",
  json5: "json",
  gql: "graphql",
  patch: "diff",
  cfg: "ini",
  dotenv: "ini",
  ex: "elixir",
  exs: "elixir",
};

const LANG_LOADERS: Record<string, () => LanguageInput> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  rust: () => import("@shikijs/langs/rust"),
  python: () => import("@shikijs/langs/python"),
  bash: () => import("@shikijs/langs/bash"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  sql: () => import("@shikijs/langs/sql"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  cpp: () => import("@shikijs/langs/cpp"),
  c: () => import("@shikijs/langs/c"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  xml: () => import("@shikijs/langs/xml"),
  graphql: () => import("@shikijs/langs/graphql"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  ini: () => import("@shikijs/langs/ini"),
  powershell: () => import("@shikijs/langs/powershell"),
  diff: () => import("@shikijs/langs/diff"),
  vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"),
  zig: () => import("@shikijs/langs/zig"),
  elixir: () => import("@shikijs/langs/elixir"),
  makefile: () => import("@shikijs/langs/makefile"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const languageLoads = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighterCore({
      themes: [import("@shikijs/themes/vitesse-dark")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

function resolveLanguage(language: string): string {
  const lower = language.toLowerCase();
  const resolved = LANG_ALIAS[lower] ?? lower;
  return LANG_LOADERS[resolved] ? resolved : BUILTIN_PLAIN;
}

async function highlight(code: string, language: string): Promise<string> {
  const highlighter = await getHighlighter();
  const lang = resolveLanguage(language);

  if (lang !== BUILTIN_PLAIN) {
    let pending = languageLoads.get(lang);
    if (!pending) {
      pending = highlighter.loadLanguage(LANG_LOADERS[lang]()).then(() => undefined);
      languageLoads.set(lang, pending);
    }
    await pending;
  }

  return highlighter.codeToHtml(code, { lang, theme: THEME });
}

export interface CodeBlockProps {
  language?: string;
  value: string;
  showLineNumbers?: boolean;
  isEditor?: boolean;
  className?: string;
}

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return { copied, copy };
}

export const CodeBlock = memo(function CodeBlock({
  language = BUILTIN_PLAIN,
  value,
  showLineNumbers = true,
  isEditor = false,
  className = "",
}: CodeBlockProps) {
  const { copied, copy } = useCopy(value);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let active = true;
    setHtml("");
    const timer = setTimeout(() => {
      highlight(value, language)
        .then((out) => {
          if (active) setHtml(out);
        })
        .catch(() => {
          if (active) setHtml("");
        });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, language]);

  const body = html ? (
    <div
      className={`CodeBlock-shiki ${showLineNumbers ? "shiki-line-numbers" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <pre className="CodeBlock-pre">
      <code>{value}</code>
    </pre>
  );

  if (isEditor) {
    return <div className={`CodeBlock CodeBlock-fullEditor ${className}`}>{body}</div>;
  }

  return (
    <div className={`CodeBlock ${className}`}>
      <div className="CodeBlock-header">
        <span className="CodeBlock-lang">{language}</span>
        <button type="button" className="CodeBlock-copy" onClick={copy} aria-label="Copy code">
          {copied ? (
            <>
              <FiCheck className="CodeBlock-copyIconDone" /> Copied
            </>
          ) : (
            <>
              <FiCopy /> Copy
            </>
          )}
        </button>
      </div>
      {body}
    </div>
  );
});

export default CodeBlock;
