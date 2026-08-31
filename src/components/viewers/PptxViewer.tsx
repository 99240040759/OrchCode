import { useState, useEffect, useRef, useCallback } from "react";
import { PPTXViewer } from "pptxviewjs";
import { dataUrlToArrayBuffer, errorMessage, readBinaryFileAsDataUrl } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";

interface PptxViewerProps {
  path: string;
}

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;
const BASE_SLIDE_WIDTH = 960;
const SLIDE_ASPECT = 9 / 16;

function applyCanvasSize(canvas: HTMLCanvasElement, zoom: number) {
  const w = Math.round(BASE_SLIDE_WIDTH * zoom);
  const h = Math.round(w * SLIDE_ASPECT);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = w * (window.devicePixelRatio || 1);
  canvas.height = h * (window.devicePixelRatio || 1);
}

export function PptxViewer({ path }: PptxViewerProps) {
  const canvasRef          = useRef<HTMLCanvasElement>(null);
  const viewerRef          = useRef<PPTXViewer | null>(null);
  const pendingBufferRef   = useRef<ArrayBuffer | null>(null);
  const renderQueueRef     = useRef<(() => Promise<void>) | null>(null);
  const renderingRef       = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [zoom, setZoom] = useState(1.0);

  const fileName = path.split(/[\\/]/).pop() ?? path;

  useEffect(() => {
    let cancelled = false;
    pendingBufferRef.current = null;

    const prevViewer = viewerRef.current;
    viewerRef.current = null;
    if (prevViewer) prevViewer.destroy();

    setLoading(true);
    setError(null);
    setSlideIndex(0);
    setSlideCount(0);
    setZoom(1.0);

    readBinaryFileAsDataUrl(path)
      .then((dataUrl) => {
        if (cancelled) return;
        pendingBufferRef.current = dataUrlToArrayBuffer(dataUrl);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [path]);

  useEffect(() => {
    if (loading || error || !pendingBufferRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const buf = pendingBufferRef.current;
    pendingBufferRef.current = null;
    let cancelled = false;

    async function initViewer() {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      try {
        applyCanvasSize(canvas!, 1.0);
        const viewer = new PPTXViewer({ canvas: canvas!, slideSizeMode: "fit" });
        viewerRef.current = viewer;
        await viewer.loadFile(buf);
        if (cancelled) return;
        setSlideCount(viewer.getSlideCount());
        setSlideIndex(viewer.getCurrentSlideIndex());
        await viewer.render(canvas!);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    }

    void initViewer();
    return () => { cancelled = true; };
  }, [loading, error]);

  const drainRenderQueue = useCallback(async () => {
    if (renderingRef.current) return;
    renderingRef.current = true;
    try {
      while (renderQueueRef.current) {
        const task = renderQueueRef.current;
        renderQueueRef.current = null;
        await task();
      }
    } finally {
      renderingRef.current = false;
    }
  }, []);

  const enqueueRender = useCallback((task: () => Promise<void>) => {
    renderQueueRef.current = task;
    void drainRenderQueue();
  }, [drainRenderQueue]);

  const zoomIn = useCallback(() => {
    const next = parseFloat(Math.min(ZOOM_MAX, zoom + ZOOM_STEP).toFixed(2));
    setZoom(next);
    enqueueRender(async () => {
      const viewer = viewerRef.current;
      const canvas = canvasRef.current;
      if (!viewer || !canvas) return;
      applyCanvasSize(canvas, next);
      await viewer.render(canvas);
    });
  }, [zoom, enqueueRender]);

  const zoomOut = useCallback(() => {
    const next = parseFloat(Math.max(ZOOM_MIN, zoom - ZOOM_STEP).toFixed(2));
    setZoom(next);
    enqueueRender(async () => {
      const viewer = viewerRef.current;
      const canvas = canvasRef.current;
      if (!viewer || !canvas) return;
      applyCanvasSize(canvas, next);
      await viewer.render(canvas);
    });
  }, [zoom, enqueueRender]);

  const zoomReset = useCallback(() => {
    setZoom(1.0);
    enqueueRender(async () => {
      const viewer = viewerRef.current;
      const canvas = canvasRef.current;
      if (!viewer || !canvas) return;
      applyCanvasSize(canvas, 1.0);
      await viewer.render(canvas);
    });
  }, [enqueueRender]);

  const goTo = useCallback((index: number) => {
    enqueueRender(async () => {
      const viewer = viewerRef.current;
      const canvas = canvasRef.current;
      if (!viewer || !canvas) return;
      applyCanvasSize(canvas, zoom);
      await viewer.goToSlide(index, canvas);
      setSlideIndex(viewer.getCurrentSlideIndex());
    });
  }, [zoom, enqueueRender]);

  const prev = useCallback(() => goTo(slideIndex - 1), [goTo, slideIndex]);
  const next = useCallback(() => goTo(slideIndex + 1), [goTo, slideIndex]);

  return (
    <div className="PptxViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocViewer-title">{fileName}</span>
        {slideCount > 0 && (
          <span className="DocViewer-meta">{slideCount} slide{slideCount !== 1 ? "s" : ""}</span>
        )}
        {!loading && !error && (
          <div className="DocViewer-zoom">
            <button className="DocViewer-zoom-btn" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
            <button className="DocViewer-zoom-pct" onClick={zoomReset} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button className="DocViewer-zoom-btn" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
          </div>
        )}
      </div>

      <div className="PptxViewer-stage">
        {loading && (
          <div className="PptxViewer-overlay">
            <div className="DocViewer-spinner" />
            <span>Loading presentation…</span>
          </div>
        )}
        {error && (
          <div className="PptxViewer-overlay PptxViewer-overlay--error">
            <span className="DocViewer-error-icon">⚠</span>
            <p>{error}</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="PptxViewer-canvas"
          style={{ display: loading || error ? "none" : "block" }}
        />
      </div>

      {slideCount > 1 && !loading && !error && (
        <div className="PptxViewer-nav">
          <button className="PptxViewer-nav-btn" disabled={slideIndex === 0} onClick={prev}>‹ Prev</button>
          <span className="PptxViewer-nav-label">{slideIndex + 1} / {slideCount}</span>
          <button className="PptxViewer-nav-btn" disabled={slideIndex === slideCount - 1} onClick={next}>Next ›</button>
        </div>
      )}
    </div>
  );
}
