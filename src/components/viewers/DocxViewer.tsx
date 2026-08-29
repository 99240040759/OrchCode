import { useState, useEffect, useRef, useCallback } from "react";
import { renderAsync } from "docx-preview";
import { dataUrlToArrayBuffer, readBinaryFileAsDataUrl } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";

interface DocxViewerProps {
  path: string;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.0;

export function DocxViewer({ path }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1.0);
  const [rendered, setRendered] = useState(false);

  const fileName = path.split(/[\\/]/).pop() ?? path;

  const zoomIn    = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, parseFloat((z + ZOOM_STEP).toFixed(2)))), []);
  const zoomOut   = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, parseFloat((z - ZOOM_STEP).toFixed(2)))), []);
  const zoomReset = useCallback(() => setZoom(1.0), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRendered(false);
    setZoom(1.0);

    async function loadDoc() {
      try {
        const dataUrl = await readBinaryFileAsDataUrl(path);
        const buffer = dataUrlToArrayBuffer(dataUrl);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        await renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true,
        });
        if (!cancelled) {
          setRendered(true);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    }

    void loadDoc();
    return () => { cancelled = true; };
  }, [path]);

  return (
    <div className="DocxViewer">
      <div className="DocxViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocxViewer-title">{fileName}</span>
        {rendered && !error && !loading && (
          <div className="DocxViewer-zoom">
            <button className="DocxViewer-zoom-btn" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
            <button className="DocxViewer-zoom-pct" onClick={zoomReset} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button className="DocxViewer-zoom-btn" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
          </div>
        )}
      </div>
      {loading && (
        <div className="DocViewer-loading">
          <div className="DocViewer-spinner" />
          <span>Loading document…</span>
        </div>
      )}
      {error && (
        <div className="DocViewer-error">
          <span className="DocViewer-error-icon">⚠</span>
          <p>{error}</p>
        </div>
      )}
      <div
        className="DocxViewer-scroll"
        style={{ display: loading || error ? "none" : "block" }}
      >
        <div
          className="DocxViewer-scaleWrap"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
        >
          <div ref={containerRef} className="DocxViewer-render" />
        </div>
      </div>
    </div>
  );
}
