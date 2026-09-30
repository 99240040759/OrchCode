import React, { useEffect, useState, SVGProps } from "react";
import { VscClose } from "react-icons/vsc";
import {
  BsFileEarmarkPdfFill,
  BsFileEarmarkWordFill,
  BsFileEarmarkExcelFill,
  BsFileEarmarkPptFill,
} from "react-icons/bs";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";
import { cn, getBasename } from "../lib/api";
import { useArtifactsStore } from "../lib/artifacts";
import { useImageDataUrl } from "../lib/images";

export function Avatar({
  src,
  fallback,
  className,
}: {
  src?: string | null;
  fallback: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span className={cn("Avatar", className)}>
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        fallback
      )}
    </span>
  );
}

export type ExplorerIconType = "file" | "folder";

export interface ExplorerIconProps extends SVGProps<SVGSVGElement> {
  type: ExplorerIconType;
  name: string;
}

export function ExplorerIcon({ type, name, className, style, ...svgProps }: ExplorerIconProps) {
  if (type === "folder") return <FolderIcon folderName={name} className={className} style={style} {...svgProps} />;

  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") {
    return <BsFileEarmarkPdfFill className={className} style={{ color: "#e2574c", ...style }} {...svgProps} />;
  }
  if (ext === "docx" || ext === "doc") {
    return <BsFileEarmarkWordFill className={className} style={{ color: "#185abd", ...style }} {...svgProps} />;
  }
  if (ext === "xlsx" || ext === "xls") {
    return <BsFileEarmarkExcelFill className={className} style={{ color: "#107c41", ...style }} {...svgProps} />;
  }
  if (ext === "pptx" || ext === "ppt") {
    return <BsFileEarmarkPptFill className={className} style={{ color: "#c43e1c", ...style }} {...svgProps} />;
  }

  return <FileIcon fileName={name} autoAssign className={className} style={style} {...svgProps} />;
}

export function ChromeIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src="/chrome.svg"
      alt=""
      className={className}
      style={{ width: 14, height: 14, flexShrink: 0, ...style }}
    />
  );
}

export interface AttachmentCardProps {
  name: string;
  isImage: boolean;
  path?: string;
  dataUrl?: string;
  onRemove?: () => void;
}

export function AttachmentCard({ name, isImage, path, dataUrl, onRemove }: AttachmentCardProps) {
  const fetched = useImageDataUrl(isImage && !dataUrl ? path : null);
  const src = dataUrl ?? fetched.src;
  const title = path ?? name;
  const showThumb = isImage && Boolean(src);

  return (
    <div className="AttachmentCard" title={title}>
      {showThumb ? (
        <span className="AttachmentCard-thumbWrap">
          <img src={src ?? undefined} alt={name} className="AttachmentCard-thumb" />
        </span>
      ) : (
        <ExplorerIcon
          type="file"
          name={name}
          className="AttachmentCard-icon"
          width={16}
          height={16}
        />
      )}
      <span className="AttachmentCard-name">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="AttachmentCard-remove"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <VscClose />
        </button>
      )}
    </div>
  );
}

export interface FileTagProps {
  path: string;
  name?: string;
  lineRange?: string;
  added?: number;
  removed?: number;
  interactive?: boolean;
}

export function FileTag({
  path,
  name,
  lineRange,
  added,
  removed,
  interactive = true,
}: FileTagProps) {
  const openFile = useArtifactsStore((s) => s.openFile);
  const filename = name || getBasename(path);
  const clickable = interactive && Boolean(path);

  const activate = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    openFile(path);
  };

  return (
    <span
      className={cn("FileTag", clickable && "FileTag-clickable")}
      title={path || filename}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? activate : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate(event);
              }
            }
          : undefined
      }
    >
      <ExplorerIcon
        type="file"
        name={filename}
        className="FileTag-icon"
        width={14}
        height={14}
      />
      <span className="FileTag-name">{filename}</span>
      {lineRange && <span className="FileTag-lineRange">{lineRange}</span>}
      {typeof added === "number" && added > 0 && <span className="FileTag-added">+{added}</span>}
      {typeof removed === "number" && removed > 0 && (
        <span className="FileTag-removed">-{removed}</span>
      )}
    </span>
  );
}

export function ThinkingShimmer() {
  return (
    <div className="ThinkingShimmer" role="status">
      <span className="ThinkingShimmer-text">Thinking…</span>
    </div>
  );
}
