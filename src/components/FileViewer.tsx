import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LuCheck, LuChevronRight, LuCode, LuCopy, LuEye, LuRotateCw } from "react-icons/lu";

import * as api from "../lib/api";
import * as utils from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import { useImageDataUrl } from "../lib/images";
import { useWorkspaceStore, workspaceMode } from "../lib/workspace";
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

function resolveLocalPath(wsPath: string | null, path: string): string {
  if (!wsPath || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) {
    return path;
  }
  return `${wsPath.replace(/[\\/]+$/, "")}/${path}`;
}

function FileBreadcrumb({ path }: { path: string }) {
  const wsName = useWorkspaceStore((s) => s.current?.name);
  const parts = utils.splitPathParts(path);
  return (
    <div className="FileBreadcrumb">
      {wsName && (
        <span className="FileBreadcrumb-item">
          <span className="FileBreadcrumb-folder">{wsName}</span>
          {parts.length > 0 && <LuChevronRight className="FileBreadcrumb-sep" />}
        </span>
      )}
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return (
          <span key={`${part}-${index}`} className="FileBreadcrumb-item">
            {index > 0 && <LuChevronRight className="FileBreadcrumb-sep" />}
            {isLast && (
              <ExplorerIcon
                type="file"
                name={part}
                className="FileBreadcrumb-fileIcon"
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
  const wsPath = useWorkspaceStore((s) => s.current?.path ?? null);
  const isCloud = useWorkspaceStore((s) =>
    s.current ? workspaceMode(s.current) === "cloud" : s.mode === "cloud"
  );
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isCloud);

  useEffect(() => {
    if (!isCloud) {
      setBlobSrc(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobSrc(null);
    api.readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setBlobSrc(objectUrl);
        setLoading(false);
      },
      (e) => {
        if (cancelled) return;
        setError(api.errorMessage(e));
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isCloud, path, mime]);

  const src = isCloud ? blobSrc : convertFileSrc(resolveLocalPath(wsPath, path));
  const viewerClass =
    kind === "audio" ? "NativeMediaViewer NativeMediaViewer--audio" : "NativeMediaViewer";

  if (error) {
    return (
      <div className={viewerClass}>
        <div className="FileContent-msg">{error}</div>
      </div>
    );
  }
  if (loading || !src) {
    return <div className={viewerClass}>{LOADING_SPINNER}</div>;
  }

  return (
    <div className={viewerClass}>
      {kind === "video" ? (
        <video key={src} controls className="NativeMediaViewer-video">
          <source src={src} type={mime} />
        </video>
      ) : (
        <audio key={src} controls className="NativeMediaViewer-audio">
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
        <ExplorerIcon type="file" name={name} className="BinaryFileMsg-icon" />
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

export function FileViewer({ path }: { path: string }) {
  const version = useArtifactsStore((s) => s.fileVersions[path] ?? 0);

  const isMd = /\.(md|markdown|mdown|mkdn|mdx)$/i.test(path);
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
                {mode === "preview" ? <LuCode /> : <LuEye />}
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
              <LuRotateCw />
            </Button>
          </Tooltip>
          <Tooltip content={copied ? "Copied" : "Copy content"} side="bottom">
            <Button
              className="IconBtn"
              onClick={copy}
              aria-label="Copy file content"
              disabled={!content}
            >
              {copied ? <LuCheck className="CodeBlock-copyIconDone" /> : <LuCopy />}
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
