import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { errorMessage, getBasename, readBinaryFile } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";
import { ViewerError, ViewerLoading, ZoomControls, useZoom } from "./ViewerChrome";

export function DocxViewer({ path }: { path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const zoom = useZoom(0.4, 2, 0.1);
  const fileName = getBasename(path);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    readBinaryFile(path)
      .then(async (buffer) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        container.innerHTML = "";
        await renderAsync(buffer, container, undefined, {
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true,
        });
      })
      .then(
        () => {
          if (!cancelled) setLoading(false);
        },
        (e) => {
          if (cancelled) return;
          setError(errorMessage(e));
          setLoading(false);
        }
      );

    return () => {
      cancelled = true;
    };
  }, [path]);

  const ready = !loading && !error;

  return (
    <div className="DocxViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocViewer-title">{fileName}</span>
        {ready && <ZoomControls {...zoom} />}
      </div>
      {loading && <ViewerLoading label="Loading document…" />}
      {error && <ViewerError message={error} />}
      <div className="DocxViewer-scroll" style={{ display: ready ? "block" : "none" }}>
        <div className="DocxViewer-scaleWrap" style={{ zoom: zoom.zoom }}>
          <div ref={containerRef} className="DocxViewer-render" />
        </div>
      </div>
    </div>
  );
}
