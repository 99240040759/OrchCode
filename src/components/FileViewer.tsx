import { useCallback, useEffect, useState } from "react";
import { FiCheck, FiChevronRight, FiCopy, FiRefreshCw } from "react-icons/fi";
import { useDebouncedCallback } from "use-debounce";
import * as api from "../lib/api";
import { getBasename, getDirname, getLanguageFromPath, splitPathParts } from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import CodeBlock, { useCopy } from "./ui/CodeBlock";
import ExplorerIcon from "./ExplorerIcon";
import { Markdown } from "./Markdown";
import { Button } from "./ui/Button";

function FileBreadcrumb({ path }: { path: string }) {
  const parts = splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="FileBreadcrumb-item">
          {index > 0 && <FiChevronRight className="FileBreadcrumb-sep" />}
          <span
            className={
              index === parts.length - 1 ? "FileBreadcrumb-file" : "FileBreadcrumb-folder"
            }
          >
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

function FilePicker({ onPick }: { onPick: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<api.FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = useDebouncedCallback(async (text: string) => {
    setLoading(true);
    try {
      setHits(await api.listWorkspaceFiles(text, 200));
      setError(null);
    } catch (e) {
      setHits([]);
      setError(api.errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, 120);

  useEffect(() => {
    void search(query);
  }, [query, search]);

  return (
    <div className="FilePicker">
      <input
        className="FilePicker-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search workspace files"
        aria-label="Search workspace files"
        spellCheck={false}
        autoFocus
      />
      <div className="FilePicker-list">
        {error ? (
          <p className="FilePicker-empty">{error}</p>
        ) : loading ? (
          <p className="FilePicker-empty">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="FilePicker-empty">No files found</p>
        ) : (
          hits.map((hit) => {
            const filename = getBasename(hit.path) || hit.name;
            const dir = getDirname(hit.path);
            return (
              <button
                type="button"
                key={hit.path}
                className="FilePicker-item"
                onClick={() => onPick(hit.path)}
              >
                <ExplorerIcon
                  type="file"
                  name={filename}
                  className="FilePicker-icon"
                  width={14}
                  height={14}
                />
                <span className="FilePicker-name">{filename}</span>
                {dir && <span className="FilePicker-path">{dir}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function FileViewer({ tabId, path }: { tabId: string; path?: string }) {
  const setTabPath = useArtifactsStore((s) => s.setTabPath);
  const version = useArtifactsStore((s) => (path ? s.fileVersions[path] ?? 0 : 0));

  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy(content);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const file = await api.readTextFile(target);
      setContent(file.content);
      setTruncated(file.truncated);
    } catch (e) {
      setContent("");
      setTruncated(false);
      setError(api.errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setContent("");
      setError(null);
      return;
    }
    void load(path);
  }, [path, version, load]);

  if (!path) {
    return (
      <div className="FileViewerFull">
        <FilePicker onPick={(picked) => setTabPath(tabId, picked)} />
      </div>
    );
  }

  const language = getLanguageFromPath(path);

  return (
    <div className="FileViewerFull">
      <div className="FileViewerBar">
        <div className="FileViewerBar-left">
          <FileBreadcrumb path={path} />
          {truncated && <span className="FileContent-trunc">truncated</span>}
        </div>
        <div className="FileViewerBar-right">
          <Button
            className="IconBtn"
            aria-label="Reload file"
            onClick={() => void load(path)}
            disabled={loading}
          >
            <FiRefreshCw />
          </Button>
          <button
            type="button"
            className="CodeBlock-copy"
            onClick={copy}
            aria-label="Copy file content"
            disabled={!content}
          >
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
      </div>
      <div className="FileViewerBody">
        {error ? (
          <div className="FileContent-msg">{error}</div>
        ) : language === "markdown" ? (
          <div className="FileViewerMarkdown">
            <Markdown>{content}</Markdown>
          </div>
        ) : (
          <CodeBlock language={language} value={content} showLineNumbers isEditor />
        )}
      </div>
    </div>
  );
}

export default FileViewer;
