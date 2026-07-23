import { useCallback, useEffect, useState } from "react";
import { FiChevronRight, FiCopy, FiCheck } from "react-icons/fi";
import * as api from "../lib/api";
import { getLanguageFromPath, splitPathParts } from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import CodeBlock, { useCopy } from "./ui/CodeBlock";
import { Markdown } from "./Markdown";

function FileBreadcrumb({ path }: { path: string }) {
  const parts = splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {parts.map((part, idx) => (
        <span key={idx} className="FileBreadcrumb-item">
          {idx > 0 && <FiChevronRight className="FileBreadcrumb-sep" />}
          <span className={idx === parts.length - 1 ? "FileBreadcrumb-file" : "FileBreadcrumb-folder"}>{part}</span>
        </span>
      ))}
    </div>
  );
}

export function FileViewer({ initialPath }: { initialPath?: string }) {
  const [path, setPath] = useState<string | null>(initialPath ?? null);
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy(content);
  const version = useArtifactsStore((s) => (initialPath ? s.fileVersions[initialPath] ?? 0 : 0));

  const openFile = useCallback(async (p: string) => {
    setPath(p);
    setError(null);
    setContent("");
    try {
      const f = await api.readTextFile(p);
      setContent(f.content);
      setTruncated(f.truncated);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (initialPath) void openFile(initialPath);
  }, [initialPath, openFile, version]);

  const lang = path ? getLanguageFromPath(path) : "text";

  return (
    <div className="FileViewerFull">
      {error ? (
        <div className="FileContent-msg">{error}</div>
      ) : path ? (
        <>
          <div className="FileViewerBar">
            <div className="FileViewerBar-left">
              <FileBreadcrumb path={path} />
              {truncated && <span className="FileContent-trunc">(truncated)</span>}
            </div>
            <div className="FileViewerBar-right">
              <button className="CodeBlock-copy" onClick={copy} aria-label="Copy file content" disabled={!content}>
                {copied ? <><FiCheck className="CodeBlock-copyIconDone" /> Copied</> : <><FiCopy /> Copy</>}
              </button>
            </div>
          </div>
          <div className="FileViewerBody">
            {lang === "markdown" ? (
              <div className="FileViewerMarkdown"><Markdown>{content}</Markdown></div>
            ) : (
              <CodeBlock language={lang} value={content} showLineNumbers isEditor />
            )}
          </div>
        </>
      ) : (
        <div className="FileContent-msg">No file selected.</div>
      )}
    </div>
  );
}
