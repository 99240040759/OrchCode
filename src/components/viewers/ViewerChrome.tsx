import { useCallback, useState } from "react";
import { VscChevronLeft, VscChevronRight } from "react-icons/vsc";

export function ViewerLoading({ label }: { label: string }) {
  return (
    <div className="DocViewer-loading" role="status">
      <div className="DocViewer-spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ViewerError({ message }: { message: string }) {
  return (
    <div className="DocViewer-error" role="alert">
      <span className="DocViewer-error-icon" aria-hidden="true">⚠</span>
      <p>{message}</p>
    </div>
  );
}

export function useZoom(min: number, max: number, step: number) {
  const [zoom, setZoom] = useState(1);
  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, Math.round(value * 100) / 100)),
    [min, max]
  );
  const zoomIn = useCallback(() => setZoom((z) => clamp(z + step)), [clamp, step]);
  const zoomOut = useCallback(() => setZoom((z) => clamp(z - step)), [clamp, step]);
  const reset = useCallback(() => setZoom(1), []);
  return { zoom, zoomIn, zoomOut, reset, canZoomIn: zoom < max, canZoomOut: zoom > min };
}

export function ZoomControls({
  zoom,
  zoomIn,
  zoomOut,
  reset,
  canZoomIn,
  canZoomOut,
}: ReturnType<typeof useZoom>) {
  return (
    <div className="DocViewer-zoom" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="DocViewer-zoom-btn"
        onClick={zoomOut}
        disabled={!canZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="DocViewer-zoom-pct"
        onClick={reset}
        aria-label={`Reset zoom, currently ${Math.round(zoom * 100)}%`}
        title="Reset zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="DocViewer-zoom-btn"
        onClick={zoomIn}
        disabled={!canZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}

interface PageControlsProps {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onGoto?: (page: number) => void;
}

export function PageControls({ page, total, onPrev, onNext, onGoto }: PageControlsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(String(page));
    setEditing(true);
  };

  const commitEdit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= 1 && n <= total && onGoto) onGoto(n);
    setEditing(false);
  };

  return (
    <nav className="DocViewer-pageNav" aria-label="Page navigation">
      <button
        type="button"
        className="DocViewer-pageBtn"
        onClick={onPrev}
        disabled={page <= 1}
        aria-label="Previous page"
        title="Previous page"
      >
        <VscChevronLeft />
      </button>

      <span className="DocViewer-pageIndicator">
        {editing ? (
          <input
            type="number"
            className="DocViewer-pageInput"
            value={draft}
            min={1}
            max={total}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label="Go to page"
          />
        ) : (
          <button
            type="button"
            className="DocViewer-pageCurrent"
            onClick={startEdit}
            aria-label={`Page ${page} of ${total}, click to navigate`}
            title="Click to jump to a page"
          >
            {page}
          </button>
        )}
        <span className="DocViewer-pageTotal" aria-hidden="true">/ {total}</span>
      </span>

      <button
        type="button"
        className="DocViewer-pageBtn"
        onClick={onNext}
        disabled={page >= total}
        aria-label="Next page"
        title="Next page"
      >
        <VscChevronRight />
      </button>
    </nav>
  );
}
