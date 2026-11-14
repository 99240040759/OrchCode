import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LuCheck, LuCode, LuCopy, LuEye, LuRotateCw } from "react-icons/lu";
import * as api from "../../lib/api";
import { getBasename, getExt, isImagePath, useCopy } from "../../lib/utils";
import { useArtifactsStore } from "../../lib/artifacts";
import { useImageDataUrl } from "../../lib/images";
import { useWorkspaceStore, workspaceMode } from "../../lib/workspace";
import { FileIcon } from "../common/FileIcon";
import { IconButton } from "../ui/Button";
import { Markdown } from "../chat/Markdown";
import { Crumbs } from "./Crumbs";
import { SourceView } from "./SourceView";

type FileKind = "image" | "video" | "audio" | "binary" | "text";

const MIMES = {
  video: { mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", mov: "video/quicktime", avi: "video/x-msvideo", mkv: "video/x-matroska", m4v: "video/mp4" },
  audio: { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac", ogg: "audio/ogg", m4a: "audio/mp4", opus: "audio/opus" },
} as const;

const BINARY = new Set(["zip", "tar", "gz", "bz2", "7z", "rar", "wasm", "ttf", "otf", "woff", "woff2", "db", "sqlite", "sqlite3", "bin", "exe", "dll", "so", "dylib"]);
const MARKDOWN = /\.(md|markdown|mdown|mkdn|mdx)$/i;

function classify(path: string): FileKind {
  const ext = getExt(path);
  if (isImagePath(path)) return "image";
  if (ext in MIMES.video) return "video";
  if (ext in MIMES.audio) return "audio";
  if (BINARY.has(ext)) return "binary";
  return "text";
}

function mimeFor(kind: "video" | "audio", path: string): string {
  const table: Record<string, string> = MIMES[kind];
  return table[getExt(path)] ?? (kind === "video" ? "video/mp4" : "audio/mpeg");
}

function resolveLocalPath(root: string | null, path: string): string {
  if (!root || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) return path;
  return `${root.replace(/[\\/]+$/, "")}/${path}`;
}

const LOADING = (
  <div className="center">
    <span className="spinner" />
  </div>
);

function ImagePreview({ path, version }: { path: string; version: number }) {
  const { src, error, loading } = useImageDataUrl(path, version);
  return (
    <div className="media-view">
      {src ? <img src={src} alt={getBasename(path)} draggable={false} /> : error ? <p className="empty">{error}</p> : loading && LOADING}
    </div>
  );
}

function MediaPreview({ path, kind }: { path: string; kind: "video" | "audio" }) {
  const mime = mimeFor(kind, path);
  const root = useWorkspaceStore((s) => s.current?.path ?? null);
  const cloud = useWorkspaceStore((s) => (s.current ? workspaceMode(s.current) === "cloud" : s.mode === "cloud"));
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBlobSrc(null);
    setError(null);
    if (!cloud) return;
    let cancelled = false;
    let url: string | null = null;
    api.readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setBlobSrc(url);
      },
      (e) => !cancelled && setError(api.errorMessage(e))
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [cloud, path, mime]);

  const src = cloud ? blobSrc : convertFileSrc(resolveLocalPath(root, path));

  return (
    <div className="media-view" data-kind={kind}>
      {error ? (
        <p className="empty">{error}</p>
      ) : !src ? (
        LOADING
      ) : kind === "video" ? (
        <video key={src} controls>
          <source src={src} type={mime} />
        </video>
      ) : (
        <audio key={src} controls>
          <source src={src} type={mime} />
        </audio>
      )}
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
  const kind = classify(path);
  if (kind !== "text") return { path, kind, content: "", truncated: false };
  const file = await api.readTextFile(path);
  return { path, kind, content: file.content, truncated: file.truncated };
}

export function FileViewer({ path }: { path: string }) {
  const version = useArtifactsStore((s) => s.fileVersions[path] ?? 0);
  const isMarkdown = MARKDOWN.test(path);
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const current = file?.path === path ? file : null;
  const content = current?.content ?? "";
  const { copied, copy } = useCopy(content);

  useEffect(() => setMode("preview"), [path]);

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
  }, [path, version, reload]);

  const kind = current?.kind;
  const isText = !kind || kind === "text";

  return (
    <>
      <div className="toolbar">
        <Crumbs path={path} />
        {current?.truncated && <span className="badge trunc">Truncated</span>}
        {isText && (
          <div className="toolbar-group">
            {isMarkdown && (
              <IconButton
                label={mode === "preview" ? "View source" : "Preview"}
                size="sm"
                onClick={() => setMode((m) => (m === "preview" ? "code" : "preview"))}
              >
                {mode === "preview" ? <LuCode /> : <LuEye />}
              </IconButton>
            )}
            <IconButton label="Reload" size="sm" disabled={loading} onClick={() => setReload((t) => t + 1)}>
              <LuRotateCw />
            </IconButton>
            <IconButton label={copied ? "Copied" : "Copy contents"} size="sm" disabled={!content} onClick={copy}>
              {copied ? <LuCheck /> : <LuCopy />}
            </IconButton>
          </div>
        )}
      </div>
      {error ? (
        <p className="empty">{error}</p>
      ) : !current ? (
        LOADING
      ) : kind === "image" ? (
        <ImagePreview path={path} version={version + reload} />
      ) : kind === "video" || kind === "audio" ? (
        <MediaPreview key={`${path}:${version}`} path={path} kind={kind} />
      ) : kind === "binary" ? (
        <div className="empty">
          <FileIcon name={getBasename(path)} />
          <span>Binary file (.{getExt(path)}) can't be shown as text</span>
        </div>
      ) : isMarkdown && mode === "preview" ? (
        <div className="doc">
          <Markdown>{content}</Markdown>
        </div>
      ) : (
        <SourceView key={path} path={path} content={content} />
      )}
    </>
  );
}
