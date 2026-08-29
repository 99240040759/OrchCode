import { useCallback, useEffect, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useDebouncedCallback } from "use-debounce";
import { VscCheck, VscChevronRight, VscCode, VscCopy, VscPreview, VscRefresh } from "react-icons/vsc";

import editorWorker from "monaco-editor/editor/editor.worker?worker&inline";
import jsonWorker from "monaco-editor/language/json/json.worker?worker&inline";
import cssWorker from "monaco-editor/language/css/css.worker?worker&inline";
import htmlWorker from "monaco-editor/language/html/html.worker?worker&inline";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker&inline";

import * as api from "../lib/api";
import { getExt, getBasename, getDirname, splitPathParts } from "../lib/utils";
import { useCopy } from "../lib/utils";
import { documentArtifactKindForPath } from "../lib/api";
import { useArtifactsStore } from "../lib/artifacts";
import { Markdown } from "./Markdown";
import { ExplorerIcon } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

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

let monacoThemeDefined = false;

const handleBeforeMount = (m: Parameters<NonNullable<React.ComponentProps<typeof Editor>["beforeMount"]>>[0]) => {
  if (monacoThemeDefined) return;
  monacoThemeDefined = true;
  m.editor.defineTheme("app-dark", {
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
  scrollbar: { horizontal: "hidden", handleMouseWheel: true },
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
  <div className="FileViewerLoading">
    <div className="Spinner" />
  </div>
);

type FileKind = "image" | "video" | "audio" | "binary" | "text" | "unknown";

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rs", "go", "java", "kt", "swift", "c", "cpp", "cc", "h", "hpp",
  "cs", "rb", "php", "scala", "r", "dart", "lua", "ex", "exs", "erl", "hrl",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "html", "htm", "css", "scss", "sass", "less",
  "json", "yaml", "yml", "toml", "xml", "ini", "env", "conf", "config",
  "md", "mdx", "txt", "csv", "log", "sql", "graphql", "gql",
  "vue", "svelte", "astro",
  "tf", "hcl", "dockerfile", "makefile",
]);

function mimeToKind(mime: string, ext: string): FileKind {
  if (CODE_EXTENSIONS.has(ext)) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const binaryMimes = new Set([
    "application/zip", "application/x-tar", "application/gzip",
    "application/x-bzip2", "application/x-7z-compressed", "application/x-rar-compressed",
    "application/octet-stream", "application/wasm",
    "font/ttf", "font/otf", "font/woff", "font/woff2",
    "application/x-sqlite3", "application/vnd.sqlite3",
  ]);
  if (binaryMimes.has(mime)) return "binary";
  return "text";
}

function FileBreadcrumb({ path }: { path: string }) {
  const parts = splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="FileBreadcrumb-item">
          {index > 0 && <VscChevronRight className="FileBreadcrumb-sep" />}
          <span className={index === parts.length - 1 ? "FileBreadcrumb-file" : "FileBreadcrumb-folder"}>
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
                <ExplorerIcon type="file" name={filename} className="FilePicker-icon" width={14} height={14} />
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

function NativeImageViewer({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.readImageDataUrl(path)
      .then((url) => { if (!cancelled) { setSrc(url); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(api.errorMessage(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <div className="FileViewerLoading"><div className="Spinner" /></div>;
  if (error) return <div className="FileContent-msg">{error}</div>;
  return (
    <div className="NativeMediaViewer">
      <img src={src!} alt={getBasename(path)} className="NativeMediaViewer-img" draggable={false} />
    </div>
  );
}

type MediaKind = "video" | "audio";

const VIDEO_MIMES: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg",
  mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska", m4v: "video/mp4",
};
const AUDIO_MIMES: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
  aac: "audio/aac", ogg: "audio/ogg", m4a: "audio/mp4", opus: "audio/opus",
};

function NativeMediaViewer({ path, kind }: { path: string; kind: MediaKind }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ext = getExt(path);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.readBinaryFileAsDataUrl(path)
      .then((url) => { if (!cancelled) { setSrc(url); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(api.errorMessage(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <div className="FileViewerLoading"><div className="Spinner" /></div>;
  if (error) return <div className="FileContent-msg">{error}</div>;

  const mime = kind === "video"
    ? (VIDEO_MIMES[ext] ?? "video/mp4")
    : (AUDIO_MIMES[ext] ?? "audio/mpeg");

  return (
    <div className={`NativeMediaViewer${kind === "audio" ? " NativeMediaViewer--audio" : ""}`}>
      {kind === "video" ? (
        <video controls className="NativeMediaViewer-video">
          <source src={src!} type={mime} />
        </video>
      ) : (
        <audio controls className="NativeMediaViewer-audio">
          <source src={src!} type={mime} />
        </audio>
      )}
    </div>
  );
}

function BinaryFileMessage({ path }: { path: string }) {
  const ext = getExt(path);
  return (
    <div className="FileContent-msg">
      <div className="BinaryFileMsg">
        <ExplorerIcon type="file" name={getBasename(path)} width={40} height={40} className="BinaryFileMsg-icon" />
        <span className="BinaryFileMsg-name">{getBasename(path)}</span>
        <span className="BinaryFileMsg-hint">Binary file (.{ext}) — cannot be displayed as text</span>
      </div>
    </div>
  );
}

export function FileViewer({ tabId, path }: { tabId: string; path?: string }) {
  const setTabPath = useArtifactsStore((s) => s.setTabPath);

  const isMd = Boolean(path && /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path));
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileKind, setFileKind] = useState<FileKind | null>(null);
  const { copied, copy } = useCopy(content);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    setFileKind(null);
    try {
      const meta = await api.readDocumentMetadata(target);
      const kind = mimeToKind(meta.mime, meta.extension);
      setFileKind(kind);
      if (kind === "text") {
        const file = await api.readTextFile(target);
        setContent(file.content);
        setTruncated(file.truncated);
      }
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
      setFileKind(null);
      return;
    }
    if (documentArtifactKindForPath(path)) return;
    setMode("preview");
    void load(path);
  }, [path, load]);

  if (!path) {
    return (
      <div className="FileViewerFull">
        <FilePicker onPick={(picked) => setTabPath(tabId, picked)} />
      </div>
    );
  }

  if (fileKind === "image") {
    return (
      <div className="FileViewerFull">
        <div className="FileViewerBar">
          <div className="FileViewerBar-left"><FileBreadcrumb path={path} /></div>
        </div>
        <div className="FileViewerBody"><NativeImageViewer path={path} /></div>
      </div>
    );
  }

  if (fileKind === "video") {
    return (
      <div className="FileViewerFull">
        <div className="FileViewerBar">
          <div className="FileViewerBar-left"><FileBreadcrumb path={path} /></div>
        </div>
        <div className="FileViewerBody"><NativeMediaViewer path={path} kind="video" /></div>
      </div>
    );
  }

  if (fileKind === "audio") {
    return (
      <div className="FileViewerFull">
        <div className="FileViewerBar">
          <div className="FileViewerBar-left"><FileBreadcrumb path={path} /></div>
        </div>
        <div className="FileViewerBody"><NativeMediaViewer path={path} kind="audio" /></div>
      </div>
    );
  }

  if (fileKind === "binary") {
    return (
      <div className="FileViewerFull">
        <div className="FileViewerBar">
          <div className="FileViewerBar-left"><FileBreadcrumb path={path} /></div>
        </div>
        <div className="FileViewerBody"><BinaryFileMessage path={path} /></div>
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
          {isMd && (
            <Tooltip content={mode === "preview" ? "View source code" : "Preview markdown"} side="bottom">
              <Button
                className="IconBtn"
                aria-label={mode === "preview" ? "View source code" : "Preview markdown"}
                onClick={() => setMode((m) => (m === "preview" ? "code" : "preview"))}
              >
                {mode === "preview" ? <VscCode /> : <VscPreview />}
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Reload file" side="bottom">
            <Button className="IconBtn" aria-label="Reload file" onClick={() => void load(path)} disabled={loading}>
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
                <><VscCheck className="CodeBlock-copyIconDone" /> Copied</>
              ) : (
                <><VscCopy /> Copy</>
              )}
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="FileViewerBody">
        {loading && !content ? (
          <div className="FileViewerLoading"><div className="Spinner" /></div>
        ) : error ? (
          <div className="FileContent-msg">{error}</div>
        ) : isMd && mode === "preview" ? (
          <div className="FileViewerMarkdown"><Markdown>{content}</Markdown></div>
        ) : (
          <Editor
            key={path}
            height="100%"
            path={path}
            value={content}
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
