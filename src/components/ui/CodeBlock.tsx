import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { codeToHtml } from "shiki";

const THEME = "vitesse-dark";

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
    // Debounced so a fast-streaming response doesn't re-run shiki on every delta — but
    // during that entire debounce window `html` would otherwise stay whatever it was
    // last set to. Since it starts as "", a code block being actively streamed into
    // would render as an empty box until the stream paused long enough for this timer
    // to actually fire (in practice: not until the whole response finished). The plain
    // <pre> fallback below covers that window so raw text is always visible immediately;
    // this only ever *upgrades* it to the highlighted version once shiki catches up.
    const timer = setTimeout(() => {
      codeToHtml(value, { lang, theme: THEME })
        .then((out) => {
          if (active) setHtml(out);
        })
        .catch(() => {
          if (active) {
            codeToHtml(value, { lang: "text", theme: THEME }).then((out) => {
              if (active) setHtml(out);
            });
          }
        });
    }, 80);
    return () => { active = false; clearTimeout(timer); };
  }, [value, lang]);

  const shikiClass = `CodeBlock-shiki ${showLineNumbers ? "shiki-line-numbers" : ""}`;
  const body = html
    ? <div className={shikiClass} dangerouslySetInnerHTML={{ __html: html }} />
    : <pre className={`${shikiClass} CodeBlock-plain`}><code>{value}</code></pre>;

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
          {copied ? <><FiCheck className="CodeBlock-copyIconDone" /> Copied</> : <><FiCopy /> Copy</>}
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
