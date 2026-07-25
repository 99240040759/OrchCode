import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import * as api from "../lib/api";
import ExplorerIcon from "./ExplorerIcon";

export interface AttachmentCardProps {
  name: string;
  isImage: boolean;
  path?: string;
  dataUrl?: string;
  onRemove?: () => void;
}

export function AttachmentCard({ name, isImage, path, dataUrl, onRemove }: AttachmentCardProps) {
  const [src, setSrc] = useState<string | null>(dataUrl ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (dataUrl) {
      setSrc(dataUrl);
      setFailed(false);
      return;
    }
    if (!isImage || !path) {
      setSrc(null);
      return;
    }
    let active = true;
    setFailed(false);
    api
      .readImageDataUrl(path)
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [dataUrl, isImage, path]);

  const title = path ?? name;
  const showThumb = isImage && src !== null && !failed;

  return (
    <div
      className={`AttachmentCard ${isImage ? "AttachmentCard-image" : "AttachmentCard-doc"}`}
      title={title}
    >
      {showThumb ? (
        <span className="AttachmentCard-thumbWrap">
          <img src={src} alt={name} className="AttachmentCard-thumb" />
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
          <FiX />
        </button>
      )}
    </div>
  );
}

export default AttachmentCard;
