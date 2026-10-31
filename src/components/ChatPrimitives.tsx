import React, { useEffect, useState, type SVGProps } from "react";
import { VscClose } from "react-icons/vsc";
import {
  BsFileEarmarkPdfFill,
  BsFileEarmarkWordFill,
  BsFileEarmarkExcelFill,
  BsFileEarmarkPptFill,
} from "react-icons/bs";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";
import { cn, getBasename, getExt } from "../lib/utils";
import { useArtifactsStore } from "../lib/artifacts";
import { useImageDataUrl } from "../lib/images";

export const Avatar = React.memo(function Avatar({
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
});

type ExplorerIconType = "file" | "folder";

interface ExplorerIconProps extends SVGProps<SVGSVGElement> {
  type: ExplorerIconType;
  name: string;
}

export const ExplorerIcon = React.memo(function ExplorerIcon({
  type,
  name,
  className,
  style,
  ...svgProps
}: ExplorerIconProps) {
  if (type === "folder") return <FolderIcon folderName={name} className={className} style={style} {...svgProps} />;

  const ext = getExt(name);
  if (ext === "pdf") {
    return <BsFileEarmarkPdfFill className={className} style={{ color: "#e2574c", ...style }} {...svgProps} />;
  }
  if (ext === "docx" || ext === "doc") {
    return <BsFileEarmarkWordFill className={className} style={{ color: "#185abd", ...style }} {...svgProps} />;
  }
  if (ext === "xlsx" || ext === "xls" || ext === "ods") {
    return <BsFileEarmarkExcelFill className={className} style={{ color: "#107c41", ...style }} {...svgProps} />;
  }
  if (ext === "pptx" || ext === "ppt") {
    return <BsFileEarmarkPptFill className={className} style={{ color: "#c43e1c", ...style }} {...svgProps} />;
  }

  return <FileIcon fileName={name} autoAssign className={className} style={style} {...svgProps} />;
});

export const ChromeIcon = React.memo(function ChromeIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src="/chrome.svg"
      alt=""
      className={className}
      style={{ width: 14, height: 14, flexShrink: 0, ...style }}
    />
  );
});

interface AttachmentCardProps {
  name: string;
  isImage: boolean;
  path?: string;
  dataUrl?: string;
  onOpen?: () => void;
  onRemove?: () => void;
}

export const AttachmentCard = React.memo(function AttachmentCard({
  name,
  isImage,
  path,
  dataUrl,
  onOpen,
  onRemove,
}: AttachmentCardProps) {
  const fetched = useImageDataUrl(isImage && !dataUrl ? path : null);
  const src = dataUrl ?? fetched.src;
  const title = path ?? name;
  const showThumb = isImage && Boolean(src);

  return (
    <div
      className={cn("AttachmentCard", onOpen && "AttachmentCard-clickable")}
      title={title}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      {showThumb ? (
        <span className="AttachmentCard-thumbWrap">
          <img src={src ?? undefined} alt={name} className="AttachmentCard-thumb" />
        </span>
      ) : (
        <ExplorerIcon
          type="file"
          name={name}
          className="AttachmentCard-icon"
          width={15}
          height={15}
        />
      )}
      <span className="AttachmentCard-name">{name}</span>
      {onRemove && (
        <button
          type="button"
          className="AttachmentCard-remove"
          aria-label={`Remove ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <VscClose />
        </button>
      )}
    </div>
  );
});

interface FileTagProps {
  path: string;
  name?: string;
  lineRange?: string;
  added?: number;
  removed?: number;
  interactive?: boolean;
}

export const FileTag = React.memo(function FileTag({
  path,
  name,
  lineRange,
  added,
  removed,
  interactive = true,
}: FileTagProps) {
  const openFile = useArtifactsStore((s) => s.openFile);
  const filename = name || getBasename(path) || path;
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
        width={13}
        height={13}
      />
      <span className="FileTag-name">{filename}</span>
      {lineRange && <span className="FileTag-lineRange">{lineRange}</span>}
      {typeof added === "number" && added > 0 && <span className="FileTag-added">+{added}</span>}
      {typeof removed === "number" && removed > 0 && (
        <span className="FileTag-removed">-{removed}</span>
      )}
    </span>
  );
});

export const ThinkingIndicator = React.memo(function ThinkingIndicator() {
  return (
    <div className="ThinkingIndicator" role="status">
      <span className="ThinkingIndicator-spinner" aria-hidden="true" />
      <span className="ThinkingIndicator-text">Thinking…</span>
    </div>
  );
});
