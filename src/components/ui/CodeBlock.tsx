import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type BundledLanguage,
  type BundledTheme,
  type SpecialLanguage,
} from "shiki";

const THEME: BundledTheme = "vitesse-dark";

const PRELOAD_LANGS: (BundledLanguage | SpecialLanguage)[] = [
  "text",
  "plaintext",
  "txt",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "js",
  "ts",
  "json",
  "jsonc",
  "json5",
  "html",
  "css",
  "scss",
  "less",
  "rust",
  "rs",
  "python",
  "py",
  "bash",
  "sh",
  "zsh",
  "shellscript",
  "markdown",
  "md",
  "mdx",
  "yaml",
  "yml",
  "toml",
  "sql",
  "go",
  "java",
  "cpp",
  "c",
  "csharp",
  "cs",
  "ruby",
  "rb",
  "php",
  "swift",
  "kotlin",
  "kt",
  "xml",
  "graphql",
  "dockerfile",
  "docker",
  "ini",
  "dotenv",
  "powershell",
  "ps1",
  "diff",
  "log",
  "vue",
  "svelte",
  "zig",
  "elixir",
  "makefile",
  "cmake",
];

const highlighterPromise = createHighlighter({
  themes: [THEME],
  langs: PRELOAD_LANGS,
  engine: createJavaScriptRegexEngine(),
});

async function highlight(code: string, lang: string): Promise<string> {
  const hl = await highlighterPromise;
  const targetLang = (lang || "text").toLowerCase();

  try {
    return hl.codeToHtml(code, { lang: targetLang, theme: THEME });
  } catch {
    return hl.codeToHtml(code, { lang: "text", theme: THEME });
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


