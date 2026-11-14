import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LuChevronLeft, LuChevronRight, LuMinus, LuPlus, LuTriangleAlert } from "react-icons/lu";
import { IconButton } from "../../ui/Button";
import { Crumbs } from "../Crumbs";

export function useZoom(min: number, max: number, step: number) {
  const [zoom, setZoom] = useState(1);
  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100)), [min, max]);
  return {
    zoom,
    zoomIn: () => setZoom((z) => clamp(z + step)),
    zoomOut: () => setZoom((z) => clamp(z - step)),
    reset: () => setZoom(1),
    canZoomIn: zoom < max,
    canZoomOut: zoom > min,
  };
}

export type Zoom = ReturnType<typeof useZoom>;

export function useArrowKeys(enabled: boolean, prev: () => void, next: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, prev, next]);
}

function ZoomControls({ zoom, zoomIn, zoomOut, reset, canZoomIn, canZoomOut }: Zoom) {
  return (
    <div className="toolbar-group" role="group" aria-label="Zoom">
      <IconButton label="Zoom out" size="sm" disabled={!canZoomOut} onClick={zoomOut}>
        <LuMinus />
      </IconButton>
      <button type="button" className="toolbar-value" title="Reset zoom" onClick={reset}>
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in" size="sm" disabled={!canZoomIn} onClick={zoomIn}>
        <LuPlus />
      </IconButton>
    </div>
  );
}

interface Pages {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onGoto: (page: number) => void;
}

function PageControls({ page, total, onPrev, onNext, onGoto }: Pages) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = parseInt(draft ?? "", 10);
    if (!isNaN(n) && n >= 1 && n <= total) onGoto(n);
    setDraft(null);
  };

  return (
    <div className="toolbar-group" role="group" aria-label="Pages">
      <IconButton label="Previous" size="sm" disabled={page <= 1} onClick={onPrev}>
        <LuChevronLeft />
      </IconButton>
      {draft === null ? (
        <button type="button" className="toolbar-value" title="Go to page" onClick={() => setDraft(String(page))}>
          {page} / {total}
        </button>
      ) : (
        <input
          className="toolbar-value"
          type="number"
          min={1}
          max={total}
          value={draft}
          autoFocus
          aria-label="Go to page"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      )}
      <IconButton label="Next" size="sm" disabled={page >= total} onClick={onNext}>
        <LuChevronRight />
      </IconButton>
    </div>
  );
}

interface ViewerToolbarProps {
  path: string;
  meta?: ReactNode;
  zoom?: Zoom;
  pages?: Pages;
}

export function ViewerToolbar({ path, meta, zoom, pages }: ViewerToolbarProps) {
  return (
    <div className="toolbar">
      <Crumbs path={path} />
      {meta && <span className="toolbar-meta">{meta}</span>}
      {pages && pages.total > 1 && <PageControls {...pages} />}
      {zoom && <ZoomControls {...zoom} />}
    </div>
  );
}

export function ViewerState({ loading, error, label }: { loading: boolean; error: string | null; label: string }) {
  if (error) {
    return (
      <div className="empty" role="alert">
        <LuTriangleAlert />
        <span>{error}</span>
      </div>
    );
  }
  if (!loading) return null;
  return (
    <div className="empty" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
