import { useCallback, useEffect, useRef, useState } from "react";
import { PPTXViewer } from "pptxviewjs";
import { errorMessage, getBasename, readBinaryFile } from "../../lib/api";
import { ExplorerIcon } from "../ChatPrimitives";
import { ZoomControls, useZoom } from "./ViewerChrome";

const BASE_SLIDE_WIDTH = 960;
const SLIDE_ASPECT = 9 / 16;

function applyCanvasSize(canvas: HTMLCanvasElement, zoom: number) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(BASE_SLIDE_WIDTH * zoom);
  const height = Math.round(width * SLIDE_ASPECT);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
}

type RenderTask = (viewer: PPTXViewer, canvas: HTMLCanvasElement) => Promise<void>;

export function PptxViewer({ path }: { path: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<PPTXViewer | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const readyRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const zoom = useZoom(0.25, 3, 0.15);
  const zoomValue = zoom.zoom;
  const fileName = getBasename(path);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    applyCanvasSize(canvas, 1);
    const viewer = new PPTXViewer({ canvas, slideSizeMode: "fit" });
    viewerRef.current = viewer;

    readBinaryFile(path)
      .then(async (buffer) => {
        if (cancelled) return;
        await viewer.loadFile(buffer);
        if (cancelled) return;
        await viewer.render(canvas);
        if (cancelled) return;
        setSlideCount(viewer.getSlideCount());
        setSlideIndex(viewer.getCurrentSlideIndex());
        readyRef.current = true;
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [path]);

  const enqueue = useCallback((task: RenderTask) => {
    queueRef.current = queueRef.current
      .then(async () => {
        const viewer = viewerRef.current;
        const canvas = canvasRef.current;
        if (viewer && canvas) await task(viewer, canvas);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    enqueue(async (viewer, canvas) => {
      applyCanvasSize(canvas, zoomValue);
      await viewer.render(canvas);
    });
  }, [zoomValue, enqueue]);

  const goTo = (index: number) => {
    enqueue(async (viewer, canvas) => {
      applyCanvasSize(canvas, zoomValue);
      await viewer.goToSlide(index, canvas);
      setSlideIndex(viewer.getCurrentSlideIndex());
    });
  };

  const ready = !loading && !error;

  return (
    <div className="PptxViewer">
      <div className="DocViewer-header">
        <ExplorerIcon type="file" name={fileName} width={18} height={18} />
        <span className="DocViewer-title">{fileName}</span>
        {slideCount > 0 && (
          <span className="DocViewer-meta">{slideCount} slide{slideCount !== 1 ? "s" : ""}</span>
        )}
        {ready && <ZoomControls {...zoom} />}
      </div>

      <div className="PptxViewer-stage">
        {loading && (
          <div className="PptxViewer-overlay" role="status">
            <div className="DocViewer-spinner" />
            <span>Loading presentation…</span>
          </div>
        )}
        {error && (
          <div className="PptxViewer-overlay PptxViewer-overlay--error" role="alert">
            <span className="DocViewer-error-icon" aria-hidden="true">⚠</span>
            <p>{error}</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="PptxViewer-canvas"
          style={{ visibility: ready ? "visible" : "hidden" }}
        />
      </div>

      {slideCount > 1 && ready && (
        <div className="PptxViewer-nav">
          <button type="button" className="PptxViewer-nav-btn" disabled={slideIndex === 0} onClick={() => goTo(slideIndex - 1)}>‹ Prev</button>
          <span className="PptxViewer-nav-label">{slideIndex + 1} / {slideCount}</span>
          <button type="button" className="PptxViewer-nav-btn" disabled={slideIndex === slideCount - 1} onClick={() => goTo(slideIndex + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
