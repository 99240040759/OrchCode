import { useCallback, useState } from "react";

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
    <div className="DocViewer-zoom">
      <button type="button" className="DocViewer-zoom-btn" onClick={zoomOut} disabled={!canZoomOut} aria-label="Zoom out">−</button>
      <button type="button" className="DocViewer-zoom-pct" onClick={reset} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
      <button type="button" className="DocViewer-zoom-btn" onClick={zoomIn} disabled={!canZoomIn} aria-label="Zoom in">+</button>
    </div>
  );
}
