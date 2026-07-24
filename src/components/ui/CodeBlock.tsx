import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import {
  getSingletonHighlighter,
  type BundledLanguage,
  type BundledTheme,
  isSpecialLang,
} from "shiki";

const THEME: BundledTheme = "vitesse-dark";

const PRELOAD_LANGS: BundledLanguage[] = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "html",
  "css",
  "rust",
  "python",
  "bash",
  "shell",
  "markdown",
  "yaml",
  "toml",
  "sql",
  "go",
  "java",
  "cpp",
  "c",
  "cs",
  "ruby",
  "php",
  "swift",
  "kotlin",
];

const highlighterPromise = getSingletonHighlighter({
  themes: [THEME],
  langs: PRELOAD_LANGS,
});

async function highlight(code: string, lang: string): Promise<string> {
  const hl = await highlighterPromise;

  if (!isSpecialLang(lang)) {
    const loadedLangs = hl.getLoadedLanguages();
    if (!loadedLangs.includes(lang as BundledLanguage)) {
      try {
        await hl.loadLanguage(lang as BundledLanguage);
      } catch {
        lang = "text";
      }
    }
  }

  return hl.codeToHtml(code, { lang, theme: THEME });
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
      highlight(value, lang)
        .then((out) => {
          if (active) setHtml(out);
        })
        .catch(() => {
          if (active) setHtml("");
        });
    }, 80);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value, lang]);

  const shikiClass = `CodeBlock-shiki ${showLineNumbers ? "shiki-line-numbers" : ""}`;
  const body = html ? (
    <div className={shikiClass} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <pre className={`${shikiClass} CodeBlock-plain`}>
      <code>{value}</code>
    </pre>
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
