import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { errorMessage, readBinaryFile } from "../../../lib/api";
import { ViewerState, ViewerToolbar, useArrowKeys, useZoom } from "./ViewerToolbar";

if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type RenderTask = ReturnType<pdfjs.PDFPageProxy["render"]>;

function quietly(fn: () => unknown) {
  try {
    void fn();
  } catch {
    return;
  }
}

export function PdfViewer({ path, active }: { path: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const zoom = useZoom(0.25, 4, 0.15);

  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);
    setPage(1);
    setPages(0);

    readBinaryFile(path)
      .then(async (buffer) => {
        if (cancelled) return;
        task = pdfjs.getDocument({ data: buffer });
        const doc = await task.promise;
        if (cancelled) return;
        docRef.current = doc;
        setPages(doc.numPages);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      const render = renderRef.current;
      const doc = docRef.current;
      if (render) quietly(() => render.cancel());
      if (doc) quietly(() => doc.cleanup());
      if (task) quietly(() => task?.destroy());
      renderRef.current = null;
      docRef.current = null;
    };
  }, [path]);

  const render = useCallback(async (pageNumber: number, scale: number) => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    const previous = renderRef.current;
    if (previous) quietly(() => previous.cancel());
    try {
      const pdfPage = await doc.getPage(pageNumber);
      const ratio = window.devicePixelRatio || 1;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(base.width * scale)}px`;
      canvas.style.height = `${Math.floor(base.height * scale)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = pdfPage.render({ canvasContext: ctx, canvas, viewport });
      renderRef.current = task;
      await task.promise;
    } catch (e) {
      if ((e as Error)?.name !== "RenderingCancelledException") setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!loading && !error && pages > 0) void render(page, zoom.zoom);
  }, [loading, error, pages, page, zoom.zoom, render]);

  const prev = useCallback(() => setPage((p) => Math.max(1, p - 1)), []);
  const next = useCallback(() => setPage((p) => (pages ? Math.min(pages, p + 1) : 1)), [pages]);
  useArrowKeys(active, prev, next);

  const ready = !loading && !error;

  return (
    <>
      <ViewerToolbar
        path={path}
        meta={pages > 0 ? `${pages} page${pages === 1 ? "" : "s"}` : undefined}
        zoom={ready ? zoom : undefined}
        pages={ready ? { page, total: pages, onPrev: prev, onNext: next, onGoto: setPage } : undefined}
      />
      <ViewerState loading={loading} error={error} label="Loading PDF…" />
      <div className="canvas-view" hidden={!ready}>
        <canvas ref={canvasRef} aria-label={`Page ${page} of ${pages}`} />
      </div>
    </>
  );
}
