import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import editorWorker from "monaco-editor/editor/editor.worker?worker&inline";
import jsonWorker from "monaco-editor/language/json/json.worker?worker&inline";
import cssWorker from "monaco-editor/language/css/css.worker?worker&inline";
import htmlWorker from "monaco-editor/language/html/html.worker?worker&inline";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker&inline";
import { VscCheck, VscChevronRight, VscCopy, VscRefresh } from "react-icons/vsc";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });
import { useDebouncedCallback } from "use-debounce";
import * as api from "../lib/api";
import { getBasename, getDirname, splitPathParts } from "../lib/api";
import { useArtifactsStore } from "../lib/artifacts";
import { ExplorerIcon } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

function useCopy(text: string) {
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

function FileBreadcrumb({ path }: { path: string }) {
  const parts = splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="FileBreadcrumb-item">
          {index > 0 && <VscChevronRight className="FileBreadcrumb-sep" />}
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

const handleBeforeMount = (monaco: Parameters<NonNullable<React.ComponentProps<typeof Editor>["beforeMount"]>>[0]) => {
  monaco.editor.defineTheme("app-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#181818",
      "editor.foreground": "#F0F0F0",
      "editor.lineHighlightBackground": "#262626",
      "editorLineNumber.foreground": "#F0F0F05C",
      "editorLineNumber.activeForeground": "#F0F0F0",
      "editorGutter.background": "#181818",
      "editorIndentGuide.background": "#F0F0F013",
      "editorIndentGuide.activeBackground": "#F0F0F030",
      "editor.selectionBackground": "#40404099",
      "editor.inactiveSelectionBackground": "#40404077",
      "scrollbarSlider.background": "#F0F0F011",
      "scrollbarSlider.hoverBackground": "#F0F0F01E",
      "scrollbarSlider.activeBackground": "#F0F0F01E",
      "minimap.background": "#181818",
    },
  });
};

const EDITOR_OPTIONS: React.ComponentProps<typeof Editor>["options"] = {
  readOnly: true,
  minimap: { enabled: true },
  lineNumbers: "on",
  lineNumbersMinChars: 4,
  lineDecorationsWidth: 10,
  padding: { top: 12, bottom: 12 },
  scrollBeyondLastLine: false,
  renderWhitespace: "none",
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
  fontLigatures: true,
  wordWrap: "on",
  wrappingStrategy: "advanced",
  scrollbar: {
    horizontal: "hidden",
    handleMouseWheel: true,
  },
  automaticLayout: true,
  folding: true,
  glyphMargin: false,
  overviewRulerBorder: false,
  renderLineHighlight: "gutter",
  smoothScrolling: true,
  cursorBlinking: "smooth",
  contextmenu: false,
};

const LOADING_SPINNER = (
  <div className="FileViewerLoading flex items-center justify-center p-8">
    <div className="Spinner" />
  </div>
);

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

  return (
    <div className="FileViewerFull">
      <div className="FileViewerBar">
        <div className="FileViewerBar-left">
          <FileBreadcrumb path={path} />
          {truncated && <span className="FileContent-trunc">truncated</span>}
        </div>
        <div className="FileViewerBar-right">
          <Tooltip content="Reload file" side="bottom">
            <Button
              className="IconBtn"
              aria-label="Reload file"
              onClick={() => void load(path)}
              disabled={loading}
            >
              <VscRefresh />
            </Button>
          </Tooltip>
          <Tooltip content={copied ? "Copied" : "Copy content"} side="bottom">
            <button
              type="button"
              className="CodeBlock-copy"
              onClick={copy}
              aria-label="Copy file content"
              disabled={!content}
            >
              {copied ? (
                <>
                  <VscCheck className="CodeBlock-copyIconDone" /> Copied
                </>
              ) : (
                <>
                  <VscCopy /> Copy
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="FileViewerBody">
        {loading && !content ? (
          <div className="FileViewerLoading flex items-center justify-center p-8">
            <div className="Spinner" />
          </div>
        ) : error ? (
          <div className="FileContent-msg">{error}</div>
        ) : (
          <Editor
            key={`${path}:${version}`}
            height="100%"
            path={path}
            defaultValue={content}
            theme="app-dark"
            beforeMount={handleBeforeMount}
            loading={LOADING_SPINNER}
            options={EDITOR_OPTIONS}
          />
        )}
      </div>
    </div>
  );
}

export default FileViewer;
