import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { createHighlighterCore, createJavaScriptRegexEngine } from "shiki/core";
import type { BundledTheme } from "shiki";

const THEME: BundledTheme = "vitesse-dark";

const LANG_ALIAS: Record<string, string> = {
  txt: "text",
  plaintext: "text",
  rs: "rust",
  py: "python",
  sh: "bash",
  zsh: "bash",
  js: "javascript",
  ts: "typescript",
  md: "markdown",
  yml: "yaml",
  cs: "csharp",
  rb: "ruby",
  kt: "kotlin",
  docker: "dockerfile",
  ps1: "powershell",
  log: "text",
  less: "css",
  json5: "json",
  mdx: "markdown",
  cmake: "makefile",
  dotenv: "ini",
};

const highlighterPromise = createHighlighterCore({
  themes: [import("@shikijs/themes/vitesse-dark")],
  langs: [
    import("@shikijs/langs/typescript"),
    import("@shikijs/langs/tsx"),
    import("@shikijs/langs/javascript"),
    import("@shikijs/langs/jsx"),
    import("@shikijs/langs/json"),
    import("@shikijs/langs/jsonc"),
    import("@shikijs/langs/html"),
    import("@shikijs/langs/css"),
    import("@shikijs/langs/scss"),
    import("@shikijs/langs/rust"),
    import("@shikijs/langs/python"),
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/shellscript"),
    import("@shikijs/langs/markdown"),
    import("@shikijs/langs/yaml"),
    import("@shikijs/langs/toml"),
    import("@shikijs/langs/sql"),
    import("@shikijs/langs/go"),
    import("@shikijs/langs/java"),
    import("@shikijs/langs/cpp"),
    import("@shikijs/langs/c"),
    import("@shikijs/langs/csharp"),
    import("@shikijs/langs/ruby"),
    import("@shikijs/langs/php"),
    import("@shikijs/langs/swift"),
    import("@shikijs/langs/kotlin"),
    import("@shikijs/langs/xml"),
    import("@shikijs/langs/graphql"),
    import("@shikijs/langs/dockerfile"),
    import("@shikijs/langs/ini"),
    import("@shikijs/langs/powershell"),
    import("@shikijs/langs/diff"),
    import("@shikijs/langs/vue"),
    import("@shikijs/langs/svelte"),
    import("@shikijs/langs/zig"),
    import("@shikijs/langs/elixir"),
    import("@shikijs/langs/makefile"),
  ],
  engine: createJavaScriptRegexEngine(),
});

async function highlight(code: string, lang: string): Promise<string> {
  const hl = await highlighterPromise;
  const raw = (lang || "text").toLowerCase();
  const targetLang = LANG_ALIAS[raw] ?? raw;

  try {
    return hl.codeToHtml(code, { lang: targetLang, theme: THEME });
  } catch {
    return hl.codeToHtml(code, { lang: "plaintext", theme: THEME });
  }
}

export interface CodeBlockProps {
  language?: string;
  value: string;
  showLineNumbers?: boolean;
  isEditor?: boolean;
  className?: string;
}

function useCopyToClipboard(text: string) {
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
  language,
  value,
  showLineNumbers = true,
  isEditor = false,
  className = "",
}: CodeBlockProps) {
  const lang = language || "text";
  const { copied, copy } = useCopyToClipboard(value);
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      highlight(value, lang).then((out) => {
        if (active) setHtml(out);
      });
    }, 50);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, lang]);

  const shikiClass = `CodeBlock-shiki ${showLineNumbers ? "shiki-line-numbers" : ""}`;
  const body = (
    <div className={shikiClass} dangerouslySetInnerHTML={{ __html: html }} />
  );

  if (isEditor) {
    return (
      <div className={`CodeBlock CodeBlock-fullEditor ${className}`}>
        {body}
      </div>
    );
  }

  return (
    <div className={`CodeBlock ${className}`}>
      <div className="CodeBlock-header">
        <span className="CodeBlock-lang">{lang}</span>
        <button className="CodeBlock-copy" onClick={copy} aria-label="Copy code">
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

export function useCopy(text: string) {
  return useCopyToClipboard(text);
}

export default CodeBlock;


