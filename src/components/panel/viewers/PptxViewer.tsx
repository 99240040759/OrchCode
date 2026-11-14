import { useCallback, useEffect, useRef, useState } from "react";
import { PPTXViewer } from "pptxviewjs";
import { errorMessage, readBinaryFile } from "../../../lib/api";
import { ViewerState, ViewerToolbar, useArrowKeys, useZoom } from "./ViewerToolbar";

const SLIDE_WIDTH = 960;
const SLIDE_ASPECT = 9 / 16;

function sizeCanvas(canvas: HTMLCanvasElement, zoom: number) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(SLIDE_WIDTH * zoom);
  const height = Math.round(width * SLIDE_ASPECT);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
}

type Task = (viewer: PPTXViewer, canvas: HTMLCanvasElement) => Promise<void>;

export function PptxViewer({ path, active }: { path: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<PPTXViewer | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const readyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [count, setCount] = useState(0);
  const zoom = useZoom(0.25, 3, 0.15);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    sizeCanvas(canvas, 1);
    const viewer = new PPTXViewer({ canvas, slideSizeMode: "fit" });
    viewerRef.current = viewer;

    readBinaryFile(path)
      .then(async (buffer) => {
        if (cancelled) return;
        await viewer.loadFile(buffer);
        if (cancelled) return;
        await viewer.render(canvas);
        if (cancelled) return;
        setCount(viewer.getSlideCount());
        setSlide(viewer.getCurrentSlideIndex());
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

  const enqueue = useCallback((task: Task) => {
    queue.current = queue.current
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
      sizeCanvas(canvas, zoom.zoom);
      await viewer.render(canvas);
    });
  }, [zoom.zoom, enqueue]);

  const goTo = useCallback(
    (index: number) =>
      enqueue(async (viewer, canvas) => {
        sizeCanvas(canvas, zoom.zoom);
        await viewer.goToSlide(index, canvas);
        setSlide(viewer.getCurrentSlideIndex());
      }),
    [enqueue, zoom.zoom]
  );
  const prev = useCallback(() => slide > 0 && goTo(slide - 1), [slide, goTo]);
  const next = useCallback(() => slide < count - 1 && goTo(slide + 1), [slide, count, goTo]);
  useArrowKeys(active && !loading, prev, next);

  const ready = !loading && !error;

  return (
    <>
      <ViewerToolbar
        path={path}
        meta={count > 0 ? `${count} slide${count === 1 ? "" : "s"}` : undefined}
        zoom={ready ? zoom : undefined}
        pages={ready ? { page: slide + 1, total: count, onPrev: prev, onNext: next, onGoto: (n) => goTo(n - 1) } : undefined}
      />
      <ViewerState loading={loading} error={error} label="Loading presentation…" />
      <div className="canvas-view" hidden={!ready}>
        <canvas ref={canvasRef} aria-label={`Slide ${slide + 1} of ${count}`} />
      </div>
    </>
  );
}
