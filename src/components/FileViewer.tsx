import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDebouncedCallback } from "use-debounce";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VscCheck, VscChevronRight, VscCode, VscCopy, VscPreview, VscRefresh } from "react-icons/vsc";

import * as api from "../lib/api";
import * as utils from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import { useImageDataUrl } from "../lib/images";
import { useWorkspaceStore } from "../lib/workspace";
import { Markdown } from "./Markdown";
import { CodeViewer } from "./CodeViewer";
import { ExplorerIcon } from "./ChatPrimitives";
import { Button } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";

const LOADING_SPINNER = (
  <div className="FileViewerLoading">
    <div className="Spinner" />
  </div>
);

type FileKind = "image" | "video" | "audio" | "binary" | "text";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "avi", "mkv", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus"]);

const BINARY_EXTENSIONS = new Set([
  "zip", "tar", "gz", "bz2", "7z", "rar",
  "wasm", "ttf", "otf", "woff", "woff2",
  "db", "sqlite", "sqlite3", "bin", "exe", "dll", "so", "dylib",
]);

function classifyByExtension(path: string): FileKind {
  const ext = utils.getExt(path);
  if (utils.isImagePath(path)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  return "text";
}

const MEDIA_MIMES: Record<"video" | "audio", Record<string, string>> = {
  video: {
    mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg",
    mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska", m4v: "video/mp4",
  },
  audio: {
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
    aac: "audio/aac", ogg: "audio/ogg", m4a: "audio/mp4", opus: "audio/opus",
  },
};

function mediaMime(kind: "video" | "audio", path: string): string {
  return MEDIA_MIMES[kind][utils.getExt(path)] ?? (kind === "video" ? "video/mp4" : "audio/mpeg");
}

function FileBreadcrumb({ path }: { path: string }) {
  const wsName = useWorkspaceStore((s) => s.current?.name);
  const parts = utils.splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {wsName && (
        <span className="FileBreadcrumb-item">
          <span className="FileBreadcrumb-folder">{wsName}</span>
          {parts.length > 0 && <VscChevronRight className="FileBreadcrumb-sep" />}
        </span>
      )}
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return (
          <span key={`${part}-${index}`} className="FileBreadcrumb-item">
            {index > 0 && <VscChevronRight className="FileBreadcrumb-sep" />}
            {isLast && (
              <ExplorerIcon
                type="file"
                name={part}
                className="FileBreadcrumb-fileIcon"
                width={14}
                height={14}
              />
            )}
            <span className={isLast ? "FileBreadcrumb-file" : "FileBreadcrumb-folder"}>
              {part}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function FilePicker({ onPick }: { onPick: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<api.FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    if (query === "") {
      search.cancel();
      setLoading(true);
      void api
        .listWorkspaceFiles("", 200)
        .then((res) => {
          setHits(res);
          setError(null);
        })
        .catch((e) => {
          setHits([]);
          setError(api.errorMessage(e));
        })
        .finally(() => setLoading(false));
      return () => search.cancel();
    }
    void search(query);
    return () => search.cancel();
  }, [query, search]);

  const virtualizer = useVirtualizer({
    count: hits.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 28,
    overscan: 16,
  });

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
      <div ref={listRef} className="FilePicker-list">
        {error ? (
          <p className="FilePicker-empty">{error}</p>
        ) : loading ? (
          <p className="FilePicker-empty">Searching…</p>
        ) : hits.length === 0 ? (
          <p className="FilePicker-empty">No files found</p>
        ) : (
          <div
            className="FilePicker-virtual"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const hit = hits[virtualRow.index];
              const filename = utils.getBasename(hit.path) || hit.name;
              const dir = utils.getDirname(hit.path);
              return (
                <button
                  type="button"
                  key={hit.path}
                  className="FilePicker-item"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => onPick(hit.path)}
                >
                  <ExplorerIcon type="file" name={filename} className="FilePicker-icon" width={14} height={14} />
                  <span className="FilePicker-name">{filename}</span>
                  {dir && <span className="FilePicker-path">{dir}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ImagePreview({ path, version }: { path: string; version: number }) {
  const { src, error, loading } = useImageDataUrl(path, version);
  return (
    <div className="NativeMediaViewer">
      {src ? (
        <img src={src} alt={utils.getBasename(path)} className="NativeMediaViewer-img" draggable={false} />
      ) : error ? (
        <div className="FileContent-msg">{error}</div>
      ) : loading ? (
        LOADING_SPINNER
      ) : null}
    </div>
  );
}

function MediaPreview({ path, kind }: { path: string; kind: "video" | "audio" }) {
  const mime = mediaMime(kind, path);
  const src = convertFileSrc(path);

  return (
    <div className={kind === "audio" ? "NativeMediaViewer NativeMediaViewer--audio" : "NativeMediaViewer"}>
      {kind === "video" ? (
        <video controls className="NativeMediaViewer-video">
          <source src={src} type={mime} />
        </video>
      ) : (
        <audio controls className="NativeMediaViewer-audio">
          <source src={src} type={mime} />
        </audio>
      )}
    </div>
  );
}

function BinaryFileMessage({ path }: { path: string }) {
  const name = utils.getBasename(path);
  return (
    <div className="FileContent-msg">
      <div className="BinaryFileMsg">
        <ExplorerIcon type="file" name={name} width={40} height={40} className="BinaryFileMsg-icon" />
        <span className="BinaryFileMsg-name">{name}</span>
        <span className="BinaryFileMsg-hint">Binary file (.{utils.getExt(path)}) — cannot be displayed as text</span>
      </div>
    </div>
  );
}

interface LoadedFile {
  path: string;
  kind: FileKind;
  content: string;
  truncated: boolean;
}

async function loadFile(path: string): Promise<LoadedFile> {
  const kind = classifyByExtension(path);
  if (kind !== "text") return { path, kind, content: "", truncated: false };
  const file = await api.readTextFile(path);
  return { path, kind, content: file.content, truncated: file.truncated };
}

export function FileViewer({ tabId, path }: { tabId: string; path?: string }) {
  const setTabPath = useArtifactsStore((s) => s.setTabPath);
  const version = useArtifactsStore((s) => (path ? s.fileVersions[path] ?? 0 : 0));

  const isMd = Boolean(path && /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path));
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const current = file && file.path === path ? file : null;
  const content = current?.content ?? "";
  const { copied, copy } = utils.useCopy(content);

  useEffect(() => {
    setMode("preview");
  }, [path]);

  useEffect(() => {
    if (!path) {
      setFile(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadFile(path).then(
      (loaded) => {
        if (cancelled) return;
        setFile(loaded);
        setLoading(false);
      },
      (e) => {
        if (cancelled) return;
        setFile(null);
        setError(api.errorMessage(e));
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [path, version, reloadTick]);

  if (!path) {
    return (
      <div className="FileViewerFull">
        <FilePicker onPick={(picked) => setTabPath(tabId, picked)} />
      </div>
    );
  }

  const kind = current?.kind;

  if (kind && kind !== "text") {
    return (
      <div className="FileViewerFull">
        <div className="FileViewerBar">
          <div className="FileViewerBar-left"><FileBreadcrumb path={path} /></div>
        </div>
        <div className="FileViewerBody">
          {kind === "image" && <ImagePreview path={path} version={version + reloadTick} />}
          {(kind === "video" || kind === "audio") && <MediaPreview key={`${path}:${version}`} path={path} kind={kind} />}
          {kind === "binary" && <BinaryFileMessage path={path} />}
        </div>
      </div>
    );
  }

  return (
    <div className="FileViewerFull">
      <div className="FileViewerBar">
        <div className="FileViewerBar-left">
          <FileBreadcrumb path={path} />
          {current?.truncated && <span className="FileContent-trunc">truncated</span>}
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
            <Button
              className="IconBtn"
              aria-label="Reload file"
              onClick={() => setReloadTick((t) => t + 1)}
              disabled={loading}
            >
              <VscRefresh />
            </Button>
          </Tooltip>
          <Tooltip content={copied ? "Copied" : "Copy content"} side="bottom">
            <Button
              className="IconBtn"
              onClick={copy}
              aria-label="Copy file content"
              disabled={!content}
            >
              {copied ? <VscCheck className="CodeBlock-copyIconDone" /> : <VscCopy />}
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="FileViewerBody">
        {error ? (
          <div className="FileContent-msg">{error}</div>
        ) : !current ? (
          LOADING_SPINNER
        ) : isMd && mode === "preview" ? (
          <div className="FileViewerMarkdown"><Markdown>{content}</Markdown></div>
        ) : (
          <CodeViewer key={path} path={path} content={content} />
        )}
      </div>
    </div>
  );
}
